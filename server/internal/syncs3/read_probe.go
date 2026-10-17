package syncs3

import (
	"context"
	"errors"
	"net/http"
)

// ProbeOutcome describes this explicit read attempt, not general bucket access,
// credential validity, manifest validity, or permission to list/write objects.
type ProbeOutcome string

const (
	ProbeReadable           ProbeOutcome = "readable"
	ProbeInvalidConfig      ProbeOutcome = "invalid-config"
	ProbeInvalidCredentials ProbeOutcome = "invalid-credentials"
	ProbeInvalidKey         ProbeOutcome = "invalid-key"
	ProbeAccessDenied       ProbeOutcome = "access-denied"
	ProbeNotFound           ProbeOutcome = "not-found"
	ProbeRedirectRefused    ProbeOutcome = "redirect-refused"
	ProbeHTTPFailure        ProbeOutcome = "http-failure"
	ProbeTooLarge           ProbeOutcome = "too-large"
	ProbeBodyRejected       ProbeOutcome = "body-rejected"
	ProbeTransportFailure   ProbeOutcome = "transport-failure"
	ProbeCancelled          ProbeOutcome = "cancelled"
	ProbeDeadlineExceeded   ProbeOutcome = "deadline-exceeded"
)

// ProbeResult is safe to display without exposing the key, endpoint, ETag,
// response body or credentials. AcceptedBytes counts only a completely accepted
// object; zero on failure does NOT mean that the network received no bytes.
// HTTPStatus is omitted when the underlying reader did not provide a status;
// zero does not prove that no HTTP response arrived.
type ProbeResult struct {
	Outcome       ProbeOutcome `json:"outcome"`
	HTTPStatus    int          `json:"httpStatus,omitempty"`
	AcceptedBytes int64        `json:"acceptedBytes"`
}

// ProbeRead explicitly attempts one bounded signed GET of the caller's key. It
// neither creates a probe object nor falls back to HEAD/List/another key. It does
// not persist credentials, retry, follow redirects, or start synchronization.
// Constructing a ReadClient alone continues to perform no network operations.
//
// Only ProbeReadable with a nil error means this object was read completely in
// this attempt. In particular 403/404 do not establish that credentials work:
// S3 can return 403 for a missing key without ListBucket permission. Public
// objects can also be readable without proving the submitted credentials.
// Reference: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
func ProbeRead(ctx context.Context, cfg Config, credentials Credentials, key string, limit int64) (ProbeResult, error) {
	if ctx == nil || limit < 1 || limit > MaxObjectBytes {
		return probeFailure(ErrConfig)
	}
	if err := ctx.Err(); err != nil {
		return probeFailure(err)
	}
	client, err := NewReadClient(cfg, credentials)
	if err != nil {
		return probeFailure(err)
	}
	defer client.CloseIdleConnections()
	return probeRead(ctx, client, key, limit)
}

func probeRead(ctx context.Context, client *ReadClient, key string, limit int64) (ProbeResult, error) {
	object, err := client.GetObject(ctx, key, limit)
	if err != nil {
		return probeFailure(err)
	}
	// No Object/Bytes/ETag reference escapes into the summary. This is not a
	// promise of secure memory erasure: the temporary read buffer is GC-managed.
	return ProbeResult{Outcome: ProbeReadable, HTTPStatus: http.StatusOK, AcceptedBytes: int64(len(object.Bytes))}, nil
}

func probeFailure(err error) (ProbeResult, error) {
	result := ProbeResult{Outcome: ProbeTransportFailure}
	for _, entry := range []struct {
		err     error
		outcome ProbeOutcome
	}{
		{context.Canceled, ProbeCancelled},
		{context.DeadlineExceeded, ProbeDeadlineExceeded},
		{ErrConfig, ProbeInvalidConfig},
		{ErrCredentials, ProbeInvalidCredentials},
		{ErrKey, ProbeInvalidKey},
		{ErrTooLarge, ProbeTooLarge},
		{ErrBody, ProbeBodyRejected},
		{ErrTransport, ProbeTransportFailure},
	} {
		if errors.Is(err, entry.err) {
			result.Outcome = entry.outcome
			// Return the known sanitized sentinel, not an arbitrary wrapper which
			// could include a URL, key, server body or credential in its message.
			return result, entry.err
		}
	}
	var status *HTTPError
	if errors.As(err, &status) && status != nil && status.StatusCode >= 100 && status.StatusCode <= 599 {
		result.HTTPStatus = status.StatusCode
		switch status.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			result.Outcome = ProbeAccessDenied
		case http.StatusNotFound:
			result.Outcome = ProbeNotFound
		case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
			result.Outcome = ProbeRedirectRefused
		default:
			result.Outcome = ProbeHTTPFailure
		}
		return result, &HTTPError{StatusCode: status.StatusCode}
	}
	// Fail closed for an unrecognized error; never echo arbitrary error text.
	return result, ErrTransport
}

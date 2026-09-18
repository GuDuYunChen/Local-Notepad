package middleware

import "testing"

func TestAllowedOrigins(t *testing.T) {
	allowed := []string{
		"null",
		"http://localhost:5000",
		"http://127.0.0.1:5000",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
	}
	for _, origin := range allowed {
		if !isAllowedOrigin(origin) {
			t.Fatalf("expected origin to be allowed: %s", origin)
		}
	}
}

func TestRejectsUntrustedOrigins(t *testing.T) {
	rejected := []string{
		"https://example.com",
		"http://evil.local",
		"http://localhost:5001",
		"https://localhost:5000",
		"*",
	}
	for _, origin := range rejected {
		if isAllowedOrigin(origin) {
			t.Fatalf("expected origin to be rejected: %s", origin)
		}
	}
}

package syncengine

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxWebDAVJSONBytes int64 = 32 * 1024 * 1024

var errWebDAVNotFound = errors.New("WebDAV 资源不存在")

type WebDAVRemote struct {
	endpoint *url.URL
	username string
	password string
	client   *http.Client
}

type webDAVMultiStatus struct {
	Responses []struct {
		Href string `xml:"href"`
	} `xml:"response"`
}

type webDAVLockPayload struct {
	Token string `json:"token"`
	At    string `json:"at"`
}

func NewWebDAVRemote(endpoint, username, password string) (*WebDAVRemote, error) {
	raw := strings.TrimSpace(endpoint)
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("WebDAV 端点必须是有效的 http/https URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("WebDAV 端点不能包含账号、查询参数或片段")
	}
	if parsed.Scheme == "http" && !webDAVLoopback(parsed.Hostname()) {
		return nil, fmt.Errorf("非本机 WebDAV 必须使用 HTTPS")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if parsed.Path == "" { parsed.Path = "/" }
	parsed.RawPath = ""
	return &WebDAVRemote{
		endpoint: parsed,
		username: strings.TrimSpace(username),
		password: password,
		client: &http.Client{
			Timeout: 10 * time.Minute,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func webDAVLoopback(host string) bool {
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if strings.EqualFold(host, "localhost") { return true }
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (r *WebDAVRemote) remoteURL(rel string) string {
	next := *r.endpoint
	rel = strings.Trim(strings.TrimSpace(rel), "/")
	if rel != "" { next.Path = path.Join(strings.TrimRight(next.Path, "/"), rel) }
	next.RawPath = ""
	return next.String()
}

func (r *WebDAVRemote) request(method, rel string, body io.Reader, size int64, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(method, r.remoteURL(rel), body)
	if err != nil { return nil, &WebDAVTransportError{cause: err} }
	req.Header.Set("User-Agent", "Local-Notepad-WebDAV/1")
	if size >= 0 { req.ContentLength = size }
	if r.username != "" || r.password != "" { req.SetBasicAuth(r.username, r.password) }
	for key, value := range headers { req.Header.Set(key, value) }
	return doWebDAVRequest(r.client, req)
}

func closeResponse(resp *http.Response) {
	if resp == nil || resp.Body == nil { return }
	// Do not drain untrusted error bodies; callers already consume successful bodies.
	_ = resp.Body.Close()
}

func webDAVStatusError(resp *http.Response, action string) error {
	return webDAVHTTPFailure(resp, action, time.Now())
}

func (r *WebDAVRemote) ensureCollection(rel string) error {
	resp, err := r.request("MKCOL", rel, nil, 0, nil)
	if err != nil { return err }
	defer closeResponse(resp)
	switch resp.StatusCode {
	case http.StatusCreated, http.StatusMethodNotAllowed:
		return nil
	default:
		return webDAVStatusError(resp, "创建 WebDAV 目录")
	}
}

func (r *WebDAVRemote) ensure() error {
	if err := r.ensureCollection(""); err != nil { return err }
	for _, rel := range []string{"objects", "blobs", "manifests", "locks"} {
		if err := r.ensureCollection(rel); err != nil { return err }
	}
	return nil
}

func (r *WebDAVRemote) getBytes(rel string, limit int64) ([]byte, string, error) {
	resp, err := r.request(http.MethodGet, rel, nil, -1, nil)
	if err != nil { return nil, "", err }
	defer closeResponse(resp)
	if resp.StatusCode == http.StatusNotFound { return nil, "", errWebDAVNotFound }
	if resp.StatusCode != http.StatusOK { return nil, "", webDAVStatusError(resp, "读取 WebDAV 资源") }
	raw, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil { return nil, "", err }
	if int64(len(raw)) > limit { return nil, "", fmt.Errorf("WebDAV 资源超过安全大小限制") }
	return raw, resp.Header.Get("ETag"), nil
}

func (r *WebDAVRemote) putImmutable(rel string, data []byte, expectedHash string) error {
	resp, err := r.request(http.MethodPut, rel, bytes.NewReader(data), int64(len(data)), map[string]string{"If-None-Match": "*"})
	if err != nil {
		existing, _, readErr := r.getBytes(rel, maxWebDAVJSONBytes)
		if readErr == nil && hashBytes(existing) == expectedHash { return nil }
		return err
	}
	status := resp.StatusCode
	if status == http.StatusPreconditionFailed {
		closeResponse(resp)
		existing, _, readErr := r.getBytes(rel, maxWebDAVJSONBytes)
		if readErr != nil { return readErr }
		if hashBytes(existing) != expectedHash { return fmt.Errorf("WebDAV 不可变对象已存在但内容不同") }
		return nil
	}
	if status != http.StatusCreated && status != http.StatusOK && status != http.StatusNoContent {
		defer closeResponse(resp)
		return webDAVStatusError(resp, "写入 WebDAV 资源")
	}
	closeResponse(resp)
	existing, _, err := r.getBytes(rel, maxWebDAVJSONBytes)
	if err != nil { return err }
	if hashBytes(existing) != expectedHash { return fmt.Errorf("WebDAV 写入后 SHA-256 校验失败") }
	return nil
}

func (r *WebDAVRemote) SaveObject(hash string, data []byte) error {
	if !objectHashPattern.MatchString(hash) || hashBytes(data) != hash { return fmt.Errorf("同步对象哈希无效") }
	if err := r.ensure(); err != nil { return err }
	return r.putImmutable("objects/"+hash+".json", data, hash)
}

func (r *WebDAVRemote) LoadRecord(hash string) (Record, error) {
	var record Record
	if !objectHashPattern.MatchString(hash) { return record, fmt.Errorf("远端对象哈希无效") }
	data, _, err := r.getBytes("objects/"+hash+".json", maxWebDAVJSONBytes)
	if err != nil { return record, err }
	if hashBytes(data) != hash { return record, fmt.Errorf("远端对象 SHA-256 校验失败") }
	if err := json.Unmarshal(data, &record); err != nil { return record, fmt.Errorf("远端对象 JSON 无效: %w", err) }
	return normalizeRecord(record)
}

func (r *WebDAVRemote) VerifyBlob(hash string, size int64) error {
	if !objectHashPattern.MatchString(hash) || size < 0 { return fmt.Errorf("附件 blob 元数据无效") }
	resp, err := r.request(http.MethodGet, "blobs/"+hash, nil, -1, nil)
	if err != nil { return err }
	defer closeResponse(resp)
	if resp.StatusCode == http.StatusNotFound { return errWebDAVNotFound }
	if resp.StatusCode != http.StatusOK { return webDAVStatusError(resp, "读取远端附件 blob") }
	hasher := sha256.New()
	written, err := io.Copy(hasher, resp.Body)
	if err != nil { return err }
	if written != size || hex.EncodeToString(hasher.Sum(nil)) != hash { return fmt.Errorf("远端附件 blob SHA-256 校验失败") }
	return nil
}

func (r *WebDAVRemote) SaveBlobFile(hash, source string, size int64) error {
	if !objectHashPattern.MatchString(hash) || size < 0 { return fmt.Errorf("附件 blob 元数据无效") }
	if err := r.ensure(); err != nil { return err }
	if err := r.VerifyBlob(hash, size); err == nil { return nil } else if !errors.Is(err, errWebDAVNotFound) { return err }
	before, err := os.Lstat(source)
	if err != nil { return err }
	if !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 || before.Size() != size { return fmt.Errorf("本机附件在同步前发生变化") }
	actualSize, actualHash, err := stableFileDigest(source)
	if err != nil { return err }
	if actualSize != size || actualHash != hash { return fmt.Errorf("本机附件内容与同步计划不一致") }
	in, err := os.Open(source)
	if err != nil { return err }
	resp, requestErr := r.request(http.MethodPut, "blobs/"+hash, in, size, map[string]string{"If-None-Match": "*"})
	// net/http owns and closes request bodies after Do returns. Closing an
	// already-closed read-only file is harmless and must not turn a successful
	// upload into a sync failure.
	_ = in.Close()
	if requestErr != nil {
		if verifyErr := r.VerifyBlob(hash, size); verifyErr == nil { return nil }
		return requestErr
	}
	status := resp.StatusCode
	if status != http.StatusCreated && status != http.StatusOK && status != http.StatusNoContent && status != http.StatusPreconditionFailed {
		defer closeResponse(resp)
		return webDAVStatusError(resp, "上传附件 blob")
	}
	closeResponse(resp)
	after, err := os.Lstat(source)
	if err != nil { return err }
	if !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) { return fmt.Errorf("本机附件在上传期间发生变化") }
	return r.VerifyBlob(hash, size)
}

func (r *WebDAVRemote) MaterializeBlobExclusive(hash string, size int64, target string) error {
	if !objectHashPattern.MatchString(hash) || size < 0 { return fmt.Errorf("附件 blob 元数据无效") }
	if _, err := os.Lstat(target); err == nil {
		return fmt.Errorf("本机附件目标已存在，拒绝覆盖: %s", filepath.Base(target))
	} else if !os.IsNotExist(err) { return err }
	resp, err := r.request(http.MethodGet, "blobs/"+hash, nil, -1, nil)
	if err != nil { return err }
	defer closeResponse(resp)
	if resp.StatusCode == http.StatusNotFound { return errWebDAVNotFound }
	if resp.StatusCode != http.StatusOK { return webDAVStatusError(resp, "下载附件 blob") }
	tmp, err := os.CreateTemp(filepath.Dir(target), ".sync-webdav-*.partial")
	if err != nil { return err }
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(tmp, hasher), resp.Body)
	if copyErr != nil { _ = tmp.Close(); return copyErr }
	if written != size || hex.EncodeToString(hasher.Sum(nil)) != hash { _ = tmp.Close(); return fmt.Errorf("远端附件下载校验失败") }
	if err = tmp.Sync(); err != nil { _ = tmp.Close(); return err }
	if err = tmp.Close(); err != nil { return err }
	if err = os.Link(tmpName, target); err != nil { return fmt.Errorf("发布下载附件失败: %w", err) }
	return nil
}

func (r *WebDAVRemote) manifestNames() ([]string, error) {
	body := bytes.NewBufferString("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>")
	resp, err := r.request("PROPFIND", "manifests", body, int64(body.Len()), map[string]string{"Depth": "1", "Content-Type": "application/xml; charset=utf-8"})
	if err != nil { return nil, err }
	defer closeResponse(resp)
	if resp.StatusCode == http.StatusNotFound { return []string{}, nil }
	if resp.StatusCode != http.StatusMultiStatus { return nil, webDAVStatusError(resp, "列出 WebDAV manifest") }
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxWebDAVJSONBytes+1))
	if err != nil { return nil, err }
	if int64(len(raw)) > maxWebDAVJSONBytes { return nil, fmt.Errorf("WebDAV manifest 列表超过安全大小限制") }
	var listing webDAVMultiStatus
	if err := xml.Unmarshal(raw, &listing); err != nil { return nil, fmt.Errorf("WebDAV PROPFIND 响应无效: %w", err) }
	names := make([]string, 0, len(listing.Responses))
	seen := map[string]bool{}
	for _, item := range listing.Responses {
		href, err := url.Parse(item.Href); if err != nil { continue }
		decoded, err := url.PathUnescape(href.Path); if err != nil { continue }
		name := path.Base(strings.TrimSuffix(decoded, "/"))
		if manifestNamePattern.MatchString(name) && !seen[name] { seen[name] = true; names = append(names, name) }
	}
	return names, nil
}

func (r *WebDAVRemote) LoadManifest() (Manifest, error) {
	empty := Manifest{Format: ManifestFormat, Version: ManifestVersion, Items: map[string]string{}}
	names, err := r.manifestNames(); if err != nil { return empty, err }
	type candidate struct { name string; generation int64; hash string }
	list := make([]candidate, 0, len(names))
	for _, name := range names {
		match := manifestNamePattern.FindStringSubmatch(name); if match == nil { continue }
		generation, err := strconv.ParseInt(match[1], 10, 64); if err != nil { continue }
		list = append(list, candidate{name: name, generation: generation, hash: match[2]})
	}
	if len(list) == 0 { return empty, nil }
	sort.Slice(list, func(i, j int) bool {
		if list[i].generation == list[j].generation { return list[i].name < list[j].name }
		return list[i].generation > list[j].generation
	})
	if len(list) > 1 && list[0].generation == list[1].generation { return empty, fmt.Errorf("远端存在同一代的多个 manifest，拒绝猜测当前版本") }
	item := list[0]
	data, _, err := r.getBytes("manifests/"+item.name, maxWebDAVJSONBytes); if err != nil { return empty, err }
	if hashBytes(data) != item.hash { return empty, fmt.Errorf("远端清单 SHA-256 校验失败") }
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil { return empty, fmt.Errorf("远端清单 JSON 无效: %w", err) }
	if manifest.Format != ManifestFormat || manifest.Version != ManifestVersion || manifest.Generation != item.generation ||
		strings.TrimSpace(manifest.StoreID) == "" || manifest.Items == nil { return empty, fmt.Errorf("远端清单格式无效") }
	for _, hash := range manifest.Items { if !objectHashPattern.MatchString(hash) { return empty, fmt.Errorf("远端清单对象哈希无效") } }
	manifest.Revision = item.hash
	return manifest, nil
}

func (r *WebDAVRemote) SaveManifest(manifest Manifest) (Manifest, error) {
	if err := r.ensure(); err != nil { return Manifest{}, err }
	if manifest.Format == "" { manifest.Format = ManifestFormat }
	if manifest.Version == 0 { manifest.Version = ManifestVersion }
	if manifest.Format != ManifestFormat || manifest.Version != ManifestVersion || manifest.Generation < 1 ||
		strings.TrimSpace(manifest.StoreID) == "" || manifest.Items == nil { return Manifest{}, fmt.Errorf("同步清单格式无效") }
	manifest.Revision = ""
	data, err := json.Marshal(manifest); if err != nil { return Manifest{}, err }
	hash := hashBytes(data)
	name := fmt.Sprintf("%020d-%s.json", manifest.Generation, hash)
	if err := r.putImmutable("manifests/"+name, data, hash); err != nil { return Manifest{}, err }
	manifest.Revision = hash
	return manifest, nil
}

func (r *WebDAVRemote) readLock() (webDAVLockPayload, error) {
	var payload webDAVLockPayload
	raw, _, err := r.getBytes("locks/sync.lock/owner.json", 64*1024)
	if err != nil { return payload, err }
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Token == "" || payload.At == "" {
		return payload, fmt.Errorf("WebDAV 同步锁格式无效")
	}
	return payload, nil
}

func (r *WebDAVRemote) createLock(token string) (bool, error) {
	resp, err := r.request("MKCOL", "locks/sync.lock", nil, 0, nil)
	if err != nil { return false, err }
	status := resp.StatusCode
	if status == http.StatusMethodNotAllowed {
		closeResponse(resp)
		return false, nil
	}
	if status != http.StatusCreated {
		defer closeResponse(resp)
		return false, webDAVStatusError(resp, "创建 WebDAV 同步锁")
	}
	closeResponse(resp)

	payload, _ := json.Marshal(webDAVLockPayload{Token: token, At: time.Now().UTC().Format(time.RFC3339Nano)})
	resp, err = r.request(http.MethodPut, "locks/sync.lock/owner.json", bytes.NewReader(payload), int64(len(payload)), nil)
	if err != nil {
		_ = r.deleteLock()
		return false, err
	}
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		defer closeResponse(resp)
		_ = r.deleteLock()
		return false, webDAVStatusError(resp, "写入 WebDAV 同步锁")
	}
	closeResponse(resp)
	return true, nil
}

func (r *WebDAVRemote) deleteLock() error {
	resp, err := r.request(http.MethodDelete, "locks/sync.lock", nil, -1, nil)
	if err != nil { return err }
	defer closeResponse(resp)
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK {
		return nil
	}
	return webDAVStatusError(resp, "删除 WebDAV 同步锁")
}

func (r *WebDAVRemote) releaseLock(token string) {
	current, err := r.readLock()
	if err != nil || current.Token != token { return }
	_ = r.deleteLock()
}

func (r *WebDAVRemote) AcquireLock() (*RemoteLock, error) {
	if err := r.ensure(); err != nil { return nil, err }
	token, err := randomID(16); if err != nil { return nil, err }
	created, err := r.createLock(token); if err != nil { return nil, err }
	if !created {
		current, readErr := r.readLock()
		if readErr != nil {
			return nil, fmt.Errorf("WebDAV 同步锁已存在但不可验证，拒绝自动覆盖: %w", readErr)
		}
		createdAt, parseErr := time.Parse(time.RFC3339Nano, current.At)
		if parseErr != nil { return nil, fmt.Errorf("WebDAV 同步锁时间无效，拒绝自动回收") }
		age := time.Since(createdAt)
		if age < 0 || age <= staleLockAge { return nil, fmt.Errorf("WebDAV 远端正被其他设备使用，请稍后重试") }
		if err := r.deleteLock(); err != nil { return nil, fmt.Errorf("无法安全回收过期 WebDAV 同步锁: %w", err) }
		created, err = r.createLock(token); if err != nil { return nil, err }
		if !created { return nil, fmt.Errorf("WebDAV 同步锁被其他设备抢先取得，请稍后重试") }
	}
	return &RemoteLock{release: func() { r.releaseLock(token) }}, nil
}

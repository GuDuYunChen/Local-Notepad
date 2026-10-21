package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"
)

func TestLocalServerListenerUsesLoopbackAddress(t *testing.T) {
	server := ghttp.GetServer(fmt.Sprintf("local-listener-%d", time.Now().UnixNano()))
	configureLocalServerAddress(server, 0)
	server.SetGraceful(false)
	server.SetDumpRouterMap(false)
	server.SetAccessLogEnabled(false)
	server.SetErrorLogEnabled(false)
	server.SetLogStdout(false)
	server.BindHandler("GET:/api/listener-test", func(r *ghttp.Request) {
		r.Response.Write("loopback-only")
	})
	if err := server.Start(); err != nil {
		t.Fatal("start real local listener:", err)
	}
	t.Cleanup(func() {
		if err := server.Shutdown(); err != nil {
			t.Error("stop real local listener:", err)
		}
	})
	address := server.GetListenedAddress()
	host, portText, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" {
		t.Fatalf("local listener must bind IPv4 loopback, got %q (error %v)", address, err)
	}
	port, err := strconv.Atoi(portText)
	ports := server.GetListenedPorts()
	if err != nil || port <= 0 || port > 65535 || len(ports) != 1 || ports[0] != port {
		t.Fatalf("listener did not bind one real loopback port: address=%q ports=%v error=%v", address, ports, err)
	}
	transport := &http.Transport{DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	response, err := client.Get("http://" + address + "/api/listener-test")
	if err != nil {
		t.Fatal("real loopback HTTP request:", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 64))
	if err != nil || response.StatusCode != http.StatusOK || string(body) != "loopback-only" {
		t.Fatalf("loopback HTTP response: status=%d body=%q error=%v", response.StatusCode, body, err)
	}
	t.Logf("real local listener=%s HTTP=%d body=%q", address, response.StatusCode, body)
}

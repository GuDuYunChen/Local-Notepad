// This fixture hosts the unchanged standard-library ReadProbeHandler. It is
// deliberately not GoFrame, Electron, a user bucket, or a production server.
// The test copies the exact syncs3 production files beside this file and builds
// in module-off mode, with toolchain/module/proxy downloads disabled.
package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"./syncs3"
)

func main() {
	listener, err := net.Listen("tcp4", "127.0.0.1:27121")
	if err != nil {
		fmt.Fprintln(os.Stderr, "probe-fixture-listen-failed")
		os.Exit(1)
	}
	server := &http.Server{
		Handler:           syncs3.NewReadProbeHandler(),
		ReadHeaderTimeout: 2 * time.Second,
		ReadTimeout:       8 * time.Second,
		WriteTimeout:      8 * time.Second,
		IdleTimeout:       2 * time.Second,
		MaxHeaderBytes:    16 * 1024,
		ErrorLog:          log.New(io.Discard, "", 0),
	}
	stopped := make(chan error, 1)
	go func() { stopped <- server.Serve(listener) }()
	fmt.Println("probe-fixture-ready")
	// Parent stdin EOF is cross-platform and identifies only this child. No
	// process-name matching, global kill, signal assumptions or fixed log path.
	_, _ = io.Copy(io.Discard, os.Stdin)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if server.Shutdown(ctx) != nil {
		_ = server.Close()
	}
	if err := <-stopped; err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, "probe-fixture-serve-failed")
		os.Exit(1)
	}
}

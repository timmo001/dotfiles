package main

import (
	"os"
	"wonkey/internal/xfkey"
)

// version is set at release time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	xfkey.SetVersion(version)
	if err := xfkey.RunIO(os.Args[1:], os.Stdin, os.Stdout, os.Stderr); err != nil {
		os.Exit(xfkey.ExitCode(err))
	}
}

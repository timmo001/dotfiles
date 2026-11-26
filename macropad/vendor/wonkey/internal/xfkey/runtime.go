package xfkey

import (
	"errors"
	"io"
)

var errWriteRequired = errors.New("settings write requires explicit authorisation; no device access")

type cliRuntime struct {
	in          io.Reader
	out, errOut io.Writer
}

type CLIError struct {
	Err  error
	Code int
}

func (e *CLIError) Error() string { return e.Err.Error() }
func (e *CLIError) Unwrap() error { return e.Err }

func ExitCode(err error) int {
	if cliErr, ok := errors.AsType[*CLIError](err); ok {
		return cliErr.Code
	}
	return 1
}

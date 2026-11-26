package xfkey

import "io"

func printHumanHelp(out io.Writer, text string) error {
	_, err := io.WriteString(out, text)
	return err
}

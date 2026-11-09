// Package web embeds the static frontend into the binary.
package web

import "embed"

//go:embed static
var FS embed.FS

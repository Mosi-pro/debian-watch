// Package web embeds the static frontends (MosiDeck and MosiSail) into the binaries.
package web

import "embed"

//go:embed all:static
//go:embed all:sail
var FS embed.FS

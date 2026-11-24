package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// CatalogItem describes a Spicetify extension or custom app that Moggtify
// sets up. Tip tells people where to find it inside Spotify.
type CatalogItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Tip         string `json:"tip,omitempty"`
	Icon        string `json:"icon,omitempty"`
	Hotkey      string `json:"hotkey,omitempty"`
	Default     bool   `json:"default"`
	Required    bool   `json:"required,omitempty"`
	Source      string `json:"source"` // spicetify | moggtify | local
}

// Extensions that ship with the Spicetify engine. Default marks the curated
// set Moggtify enables on install; everything else is one click away in the
// Marketplace inside Spotify.
var bundledExtensions = []CatalogItem{
	{ID: "fullAppDisplay.js", Name: "Full App Display", Description: "Full-screen now playing view with huge album art and a blurred background.", Tip: "Profile menu → Full App Display, or double-click the cover art.", Icon: "expand", Default: true},
	{ID: "trashbin.js", Name: "Trash Bin", Description: "Throw songs or artists in the bin and never hear them again.", Tip: "Right-click a song or artist → Throw to Trashbin.", Icon: "trash", Default: true},
	{ID: "shuffle+.js", Name: "Shuffle+", Description: "A real shuffle (Fisher–Yates) for playlists, albums and your library.", Tip: "Right-click a playlist or album → Play with Shuffle+.", Icon: "shuffle", Default: true},
	{ID: "bookmark.js", Name: "Bookmark", Description: "Save pages, tracks and exact timestamps to jump back to later.", Tip: "Bookmark button in the top bar.", Icon: "bookmark", Default: true},
	{ID: "loopyLoop.js", Name: "Loopy Loop", Description: "Loop any section of a track straight from the progress bar.", Tip: "Right-click the progress bar to set loop start and end.", Icon: "loop", Default: true},
	{ID: "popupLyrics.js", Name: "Pop-up Lyrics", Description: "Synced lyrics in a separate always-on-top window.", Tip: "Lyrics button in the top bar.", Icon: "lyrics", Default: true},
	{ID: "autoSkipVideo.js", Name: "Skip Videos", Description: "Skips region-locked video content that won't play.", Tip: "Works automatically.", Icon: "skip", Default: true},
	{ID: "keyboardShortcut.js", Name: "Keyboard Shortcuts", Description: "Vim-style keyboard navigation for the whole client.", Tip: "Press ? inside Spotify for the shortcut list.", Icon: "keyboard", Default: false},
	{ID: "autoSkipExplicit.js", Name: "Skip Explicit", Description: "Automatically skips tracks marked as explicit.", Tip: "Works automatically.", Icon: "skip", Default: false},
	{ID: "webnowplaying.js", Name: "WebNowPlaying", Description: "Sends now-playing info to Rainmeter's WebNowPlaying plugin.", Tip: "Needs Rainmeter with WebNowPlaying.", Icon: "broadcast", Default: false},
}

// Custom apps that ship with the engine (+ the Marketplace we install).
var bundledApps = []CatalogItem{
	{ID: "marketplace", Name: "Marketplace", Description: "Browse and install community themes, extensions, snippets and apps right inside Spotify.", Tip: "Shop icon in Spotify's top bar.", Icon: "store", Default: true, Required: true},
	{ID: "lyrics-plus", Name: "Lyrics Plus", Description: "Synced lyrics from Musixmatch, Netease and LRCLIB with karaoke mode.", Tip: "Lyrics Plus icon in Spotify's top bar.", Icon: "lyrics", Default: true},
	{ID: "new-releases", Name: "New Releases", Description: "Everything new from the artists and podcasts you follow, in one feed.", Tip: "New Releases icon in Spotify's top bar.", Icon: "sparkle", Default: true},
	{ID: "reddit", Name: "Reddit", Description: "Discover music shared on Spotify-related subreddits.", Tip: "Reddit icon in Spotify's top bar.", Icon: "chat", Default: false},
}

// extrasFile is the Spicetify extension that carries Moggtify into Spotify:
// the top-bar button, the hub, the designs and the extras.
const extrasFile = "moggtify.js"

// extrasCatalog lists Moggtify's own add-ons (runtime/extensions.json).
func extrasCatalog() []CatalogItem {
	var list []CatalogItem
	b, _ := assets.ReadFile("runtime/extensions.json")
	_ = json.Unmarshal(b, &list)
	for i := range list {
		list[i].Source = "moggtify"
	}
	return list
}

func isBundledExt(id string) bool {
	for _, e := range bundledExtensions {
		if e.ID == id {
			return true
		}
	}
	return id == extrasFile
}

func isBundledApp(id string) bool {
	for _, a := range bundledApps {
		if a.ID == id {
			return true
		}
	}
	return false
}

// localExtensions are .js files the user dropped into Spicetify's folder.
func localExtensions() []CatalogItem {
	files, _ := filepath.Glob(filepath.Join(spiceUserData(), "Extensions", "*.js"))
	sort.Strings(files)
	var out []CatalogItem
	for _, f := range files {
		id := filepath.Base(f)
		if isBundledExt(id) {
			continue
		}
		out = append(out, CatalogItem{ID: id, Name: strings.TrimSuffix(id, ".js"), Description: "Local extension · " + id, Icon: "code", Source: "local"})
	}
	return out
}

func localApps() []CatalogItem {
	dirs, _ := os.ReadDir(filepath.Join(spiceUserData(), "CustomApps"))
	var out []CatalogItem
	for _, d := range dirs {
		if !d.IsDir() || isBundledApp(d.Name()) {
			continue
		}
		out = append(out, CatalogItem{ID: d.Name(), Name: d.Name(), Description: "Local custom app · CustomApps\\" + d.Name(), Icon: "app", Source: "local"})
	}
	return out
}

// enabledItems returns the catalog entries that cfg switches on.
func enabledItems(items []CatalogItem, on map[string]bool) []CatalogItem {
	var out []CatalogItem
	for _, it := range items {
		v, set := on[it.ID]
		if it.Required || (set && v) || (!set && it.Default) {
			out = append(out, it)
		}
	}
	return out
}

// clientConfig is what the Moggtify hub inside Spotify gets to know.
type clientConfig struct {
	Rev        int64           `json:"rev"`
	Version    string          `json:"version"`
	Design     string          `json:"design"`
	Extras     map[string]bool `json:"extras"`
	Extensions []CatalogItem   `json:"extensions"` // active Spicetify extensions
	Apps       []CatalogItem   `json:"apps"`       // active custom apps
	Repo       string          `json:"repo"`
}

// buildExtras bundles the Moggtify runtime, the designs and the extras into
// the single Spicetify extension file that ships with every install.
func buildExtras(cfg Config) []byte {
	extras := map[string]bool{}
	for _, x := range extrasCatalog() {
		v, set := cfg.Extras[x.ID]
		extras[x.ID] = (set && v) || (!set && x.Default)
	}
	c, _ := json.Marshal(clientConfig{
		Rev:        cfg.Rev,
		Version:    AppVersion,
		Design:     "spotify",
		Extras:     extras,
		Extensions: enabledItems(bundledExtensions, cfg.Extensions),
		Apps:       enabledItems(bundledApps, cfg.Apps),
		Repo:       RepoURL,
	})
	designs, _ := assets.ReadFile("runtime/themes.json")
	meta, _ := json.Marshal(extrasCatalog())

	var buf bytes.Buffer
	buf.WriteString("/* Moggtify for Spotify – generated by the Moggtify loader, do not edit */\n")
	fmt.Fprintf(&buf, "window.__MOGG_CONFIG=%s;\nwindow.__MOGG_THEMES=%s;\nwindow.__MOGG_EXTENSIONS=%s;\n", c, bytes.TrimSpace(designs), meta)
	rt, _ := assets.ReadFile("runtime/moggtify.js")
	buf.Write(bytes.ReplaceAll(rt, []byte("__MOGG_VERSION__"), []byte(AppVersion)))
	for _, x := range extrasCatalog() {
		code, err := assets.ReadFile("runtime/extensions/" + x.ID + ".js")
		if err != nil {
			continue
		}
		fmt.Fprintf(&buf, "\n;(function(){try{\n%s\n}catch(e){console.error(\"[moggtify] %s failed\",e)}})();\n", code, x.ID)
	}
	return buf.Bytes()
}

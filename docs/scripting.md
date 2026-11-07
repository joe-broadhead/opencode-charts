# Scripting

Charts has no tools RPC. Its three reads (`charts_validate`, `charts_catalogue`, `charts_themes`) answer questions a
model asks while it draws, and no script calls them, so an RPC for scripts would be code with no caller. One will be
added, with the known reads only, when a script needs it.

A script that needs a chart today runs an OpenCode session whose agent has the plugin, and asks it for the chart; the
writers then ask as they do for a person, unless that agent's rules allow them.

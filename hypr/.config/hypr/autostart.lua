-- Extra autostart processes.
-- o.launch_on_start("my-service")

o.exec_on_start("timmo-run-command system-bridge backend")
o.exec_on_start("uwsm app -- kdeconnectd")
o.exec_on_start("dot herdr start")

-- Xwayland takes its default arrow once, at startup, while Omarchy's blank
-- startup cursor is active, and Hyprland never refreshes it. Set it again,
-- unscaled, once the real cursor is back, or X11 apps show no arrow.
local restore_startup_cursor = omarchy_startup_cursor_restore
if restore_startup_cursor and restore_startup_cursor ~= timmo_xwayland_cursor_restore then
  function timmo_xwayland_cursor_restore(loaded)
    local pending = omarchy_startup_cursor_pending
    restore_startup_cursor(loaded)
    if loaded and pending then
      hl.exec_cmd("XCURSOR_THEME=" .. o.shell_quote(os.getenv("HYPRCURSOR_THEME") or "default")
        .. " XCURSOR_SIZE=" .. o.shell_quote(os.getenv("XCURSOR_SIZE") or "24")
        .. " xsetroot -cursor_name left_ptr")
    end
  end
  omarchy_startup_cursor_restore = timmo_xwayland_cursor_restore
end

require("hypr.host.autostart")

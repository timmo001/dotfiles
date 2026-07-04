hl.env("OMARCHY_HOST", "laptop")

-- Intel-only GPU: use the iHD VA-API driver (Mesa EGL is the default).
hl.env("LIBVA_DRIVER_NAME", "iHD")

hl.env("OMARCHY_HOST", "desktop")

-- Nvidia + Wayland (desktop has an Nvidia GPU).
hl.env("__GLX_VENDOR_LIBRARY_NAME", "nvidia")
hl.env("__NV_PRIME_RENDER_OFFLOAD", "1")
hl.env("LIBVA_DRIVER_NAME", "nvidia")
hl.env("NVD_BACKEND", "direct")

local M = {}

local function read_file(path)
  local file = io.open(path, "r")
  if not file then return "" end

  local value = file:read("*a") or ""
  file:close()

  return value:lower()
end

local function contains_virtual_machine_marker(value)
  return value:find("qemu", 1, true)
    or value:find("kvm", 1, true)
    or value:find("virtualbox", 1, true)
    or value:find("vmware", 1, true)
    or value:find("parallels", 1, true)
    or value:find("hyper%-v")
    or value:find("bochs", 1, true)
end

function M.is_virtual_machine()
  local dmi = table.concat({
    read_file("/sys/class/dmi/id/sys_vendor"),
    read_file("/sys/class/dmi/id/product_name"),
    read_file("/sys/class/dmi/id/board_vendor"),
    read_file("/sys/class/dmi/id/board_name"),
  }, "\n")

  return contains_virtual_machine_marker(dmi) ~= nil
end

return M

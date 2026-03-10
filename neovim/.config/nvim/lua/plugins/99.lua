return {
  "ThePrimeagen/99",
  config = function()
    local _99 = require("99")

    _99.setup({
      -- Auto-include AGENT.md files from parent directories
      md_files = {
        "AGENT.md",
      },
      -- completion = {
      --   source = "blink",
      -- },
    })

    -- visual must be set in visual mode; uses the current/last visual selection
    vim.keymap.set("v", "<leader>9v", function()
      _99.visual()
    end, { desc = "99: Visual" })

    vim.keymap.set("n", "<leader>9x", function()
      _99.stop_all_requests()
    end, { desc = "99: Stop all" })

    vim.keymap.set("n", "<leader>9s", function()
      _99.search()
    end, { desc = "99: Search" })

    vim.keymap.set("n", "<leader>9V", function()
      _99.vibe()
    end, { desc = "99: Vibe" })

    vim.keymap.set("n", "<leader>9o", function()
      _99.open()
    end, { desc = "99: Open" })

    vim.keymap.set("n", "<leader>9l", function()
      _99.view_logs()
    end, { desc = "99: Logs" })

    vim.keymap.set("n", "<leader>9c", function()
      _99.clear_previous_requests()
    end, { desc = "99: Clear" })

    vim.keymap.set("n", "<leader>9i", function()
      _99.info()
    end, { desc = "99: Info" })

    vim.keymap.set("n", "<leader>9t", function()
      _99.tutorial()
    end, { desc = "99: Tutorial" })
  end,
}

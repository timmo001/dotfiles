return {
  "nvim-telescope/telescope.nvim",
  --tag = "0.1.8",
  dependencies = { "nvim-lua/plenary.nvim", { "nvim-telescope/telescope-fzf-native.nvim", build = "make" } },
  config = function()
    local ts = require("telescope")

    ts.setup({
      extensions = {
        fzf = {},
      },
    })

    ts.load_extension("fzf")

    local builtin = require("telescope.builtin")

    -- vim.keymap.set("n", "<space>fd", builtin.find_files, { desc = "Telescope find files" })
    -- vim.keymap.set("n", "<space>fg", builtin.live_grep, { desc = "Telescope live grep" })
    -- vim.keymap.set("n", "<space>fb", builtin.buffers, { desc = "Telescope buffers" })
    -- vim.keymap.set("n", "<space>fh", builtin.help_tags, { desc = "Telescope help tags" })

    vim.keymap.set("n", "<space>sh", builtin.help_tags, { desc = "[S]earch [H]elp" })
    vim.keymap.set("n", "<space>sk", builtin.keymaps, { desc = "[S]earch [K]eymaps" })
    vim.keymap.set("n", "<space>sf", builtin.find_files, { desc = "[S]earch [F]iles" })
    vim.keymap.set("n", "<space>ss", builtin.builtin, { desc = "[S]earch [S]elect Telescope" })
    vim.keymap.set("n", "<space>sw", builtin.grep_string, { desc = "[S]earch current [W]ord" })
    vim.keymap.set("n", "<space>sg", builtin.live_grep, { desc = "[S]earch by [G]rep" })
    vim.keymap.set("n", "<space>sd", builtin.diagnostics, { desc = "[S]earch [D]iagnostics" })
    vim.keymap.set("n", "<space>sr", builtin.resume, { desc = "[S]earch [R]esume" })
    vim.keymap.set("n", "<space>s.", builtin.oldfiles, { desc = '[S]earch Recent Files ("." for repeat)' })
    vim.keymap.set("n", "<space><space>", builtin.buffers, { desc = "[ ] Find existing buffers" })

    -- Opens find files window in the nvim config dir (edit neovim)
    vim.keymap.set("n", "<space>en", function()
      builtin.find_files({
        cwd = vim.fn.stdpath("config"),
      })
    end, { desc = "Search files in nvim config dir" })

    -- Opens find files window in the repos dir
    vim.keymap.set("n", "<space>er", function()
      builtin.find_files({
        cwd = "~/repos",
      })
    end, { desc = "Search files in ~/repos dir" })

    -- Looks at the plugins directory
    vim.keymap.set("n", "<space>ep", function()
      builtin.find_files({
        cwd = vim.fs.joinpath(vim.fn.stdpath("data") .. "lazy"),
      })
    end, { desc = "Search files in nvim plugins dir" })

    require("config.telescope.multigrep").setup()
  end,
}

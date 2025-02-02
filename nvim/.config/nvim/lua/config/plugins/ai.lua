return {
  {
    "yetone/avante.nvim",
    event = "VeryLazy",
    lazy = false,
    version = false, -- Set to false to use the latest release
    opts = {
      ---@alias Provider "claude" | "openai" | "azure" | "gemini" | "cohere" | "copilot" | "ollama" | string
      provider = "ollama",
      auto_suggestions_provider = "ollama",
      vendors = {
        --@type AvanteProvider
        ollama = {
          __inherited_from = "openai",
          api_key_name = "",
          endpoint = "http://127.0.0.1:11434/v1",
          model = "codegemma",
        },
      },
      behaviour = {
        auto_suggestions = true,
        auto_set_highlight_group = true,
        auto_set_keymaps = true,
        auto_apply_diff_after_generation = false,
        support_paste_from_clipboard = false,
        minimize_diff = true,
      },
      windows = {
        wrap = true,
        width = 30,
        ask = {
          floating = true,
          start_insert = true,
          border = "rounded",
          -- Remove or set focus_on_apply to nil
          focus_on_apply = nil,
          sidebar = false,
          window = {
            layout = "float",
            width = 0.8,
            height = 0.8,
          },
        },
      },
      use_absolute_path = true,
    },
    build = "make",
    -- build = "powershell -ExecutionPolicy Bypass -File Build.ps1 -BuildFromSource false" -- for windows
    dependencies = {
      "stevearc/dressing.nvim",
      "nvim-lua/plenary.nvim",
      "MunifTanjim/nui.nvim",
      --- The below dependencies are optional,
      "nvim-telescope/telescope.nvim", -- for file_selector provider telescope
      "hrsh7th/nvim-cmp",              -- autocompletion for avante commands and mentions
      "echasnovski/mini.icons",        -- for icons in avante
      "zbirenbaum/copilot.lua",        -- for providers 'copilot' and 'ollama'
      {
        -- support for image pasting
        "HakonHarnes/img-clip.nvim",
        event = "VeryLazy",
        opts = {
          -- recommended settings
          default = {
            embed_image_as_base64 = false,
            prompt_for_file_name = false,
            drag_and_drop = {
              insert_mode = true,
            },
            -- required for Windows users
            use_absolute_path = true,
          },
        },
      },
      {
        -- Make sure to set this up properly if you have lazy=true
        'MeanderingProgrammer/render-markdown.nvim',
        opts = {
          file_types = { "markdown", "Avante" },
        },
        ft = { "markdown", "Avante" },
      },
    },
  },

  -- Copilot
  {
    enabled = false,
    "github/copilot.vim",
  },

  -- Copilot Chat
  {
    enabled = false,
    "CopilotC-Nvim/CopilotChat.nvim",
    -- branch = "canary",
    dependencies = {
      { "github/copilot.vim" },            -- or github/copilot.vim
      { "nvim-lua/plenary.nvim" },         -- for curl, log wrapper
      { "nvim-telescope/telescope.nvim" }, -- Use telescope for help actions
    },
    opts = {
      debug = true,     -- Enable debugging
      show_help = true, -- Show help actions
      window = {
        layout = "float",
      },
      auto_follow_cursor = false, -- Don't follow the cursor after getting response
    },
    config = function(_, opts)
      local chat = require("CopilotChat")
      local select = require("CopilotChat.select")
      -- Use unnamed register for the selection
      opts.selection = select.unnamed

      -- Override the git prompts message
      -- opts.prompts.Commit = {
      -- prompt = "Write commit message for the change with commitizen convention",
      -- selection = select.gitdiff,
      -- }
      -- opts.prompts.CommitStaged = {
      -- prompt = "Write commit message for the change with commitizen convention",
      -- selection = function(source)
      -- return select.gitdiff(source, true)
      -- end,
      -- }

      chat.setup(opts)

      vim.api.nvim_create_user_command("CopilotChatVisual", function(args)
        chat.ask(args.args, { selection = select.visual })
      end, { nargs = "*", range = true })

      -- Inline chat with Copilot
      vim.api.nvim_create_user_command("CopilotChatInline", function(args)
        chat.ask(args.args, {
          selection = select.visual,
          window = {
            layout = "float",
            relative = "cursor",
            width = 1,
            height = 0.4,
            row = 1,
          },
        })
      end, { nargs = "*", range = true })

      -- Restore CopilotChatBuffer
      vim.api.nvim_create_user_command("CopilotChatBuffer", function(args)
        chat.ask(args.args, { selection = select.buffer })
      end, { nargs = "*", range = true })
    end,
    event = "VeryLazy",
    keys = {
      -- Show help actions with telescope
      {
        "<leader>cch",
        function()
          local actions = require("CopilotChat.actions")
          require("CopilotChat.integrations.telescope").pick(actions.help_actions())
        end,
        desc = "CopilotChat - Help actions",
      },
      -- Show prompts actions with telescope
      {
        "<leader>ccp",
        function()
          local actions = require("CopilotChat.actions")
          require("CopilotChat.integrations.telescope").pick(actions.prompt_actions())
        end,
        desc = "CopilotChat - Prompt actions",
      },
      -- Code related commands
      { "<leader>cce", "<cmd>CopilotChatExplain<cr>",       desc = "CopilotChat - Explain code" },
      { "<leader>cct", "<cmd>CopilotChatTests<cr>",         desc = "CopilotChat - Generate tests" },
      { "<leader>ccr", "<cmd>CopilotChatReview<cr>",        desc = "CopilotChat - Review code" },
      { "<leader>ccR", "<cmd>CopilotChatRefactor<cr>",      desc = "CopilotChat - Refactor code" },
      { "<leader>ccn", "<cmd>CopilotChatBetterNamings<cr>", desc = "CopilotChat - Better Naming" },
      -- Chat with Copilot in visual mode
      {
        "<leader>ccv",
        ":CopilotChatVisual",
        mode = "x",
        desc = "CopilotChat - Open in vertical split",
      },
      {
        "<leader>ccx",
        ":CopilotChatInline<cr>",
        mode = "x",
        desc = "CopilotChat - Inline chat",
      },
      -- Custom input for CopilotChat
      {
        "<leader>cci",
        function()
          local input = vim.fn.input("Ask Copilot: ")
          if input ~= "" then
            vim.cmd("CopilotChat " .. input)
          end
        end,
        desc = "CopilotChat - Ask input",
      },
      -- Generate commit message based on the git diff
      {
        "<leader>ccm",
        "<cmd>CopilotChatCommit<cr>",
        desc = "CopilotChat - Generate commit message for all changes",
      },
      {
        "<leader>ccM",
        "<cmd>CopilotChatCommitStaged<cr>",
        desc = "CopilotChat - Generate commit message for staged changes",
      },
      -- Quick chat with Copilot
      {
        "<leader>ccq",
        function()
          local input = vim.fn.input("Quick Chat: ")
          if input ~= "" then
            vim.cmd("CopilotChatBuffer " .. input)
          end
        end,
        desc = "CopilotChat - Quick chat",
      },
      -- Debug
      { "<leader>ccd", "<cmd>CopilotChatDebugInfo<cr>",     desc = "CopilotChat - Debug Info" },
      -- Fix the issue with diagnostic
      { "<leader>ccf", "<cmd>CopilotChatFixDiagnostic<cr>", desc = "CopilotChat - Fix Diagnostic" },
      -- Clear buffer and chat history
      { "<leader>ccl", "<cmd>CopilotChatReset<cr>",         desc = "CopilotChat - Clear buffer and chat history" },
      -- Toggle Copilot Chat Vsplit
      { "<leader>ccv", "<cmd>CopilotChatToggle<cr>",        desc = "CopilotChat - Toggle Vsplit" },
    },
  },
}

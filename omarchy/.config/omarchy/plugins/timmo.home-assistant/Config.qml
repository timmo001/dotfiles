import QtQuick

QtObject {
  id: root

  readonly property var colors: ({
    foreground: "",
    purple: "#ac77e5",
    teal: "#2bb3b1",
    red: "#e06c75",
    blue: "#61afef",
    fadedBlue: "#718496",
    rust: "#a55555",
    orange: "#e7ad63",
    tan: "#c6a47a",
    vocCritical: "#bf6a4e",
    co2Critical: "#d56f69",
    cream: "#fef6ea"
  })

  readonly property var bar: ({
    label: "Home Assistant",
    icon: "󰟐",
    fontSize: 10,
    horizontalMargin: 6,
    rowSpacing: 12,
    colors: {
      quiet: root.colors.foreground,
      active: root.colors.teal,
      warning: root.colors.orange,
      critical: root.colors.red,
      unavailable: root.colors.rust
    }
  })

  readonly property var panel: ({
    title: "Home Assistant",
    width: 430,
    maxHeight: 670,
    contentSpacing: 2,
    groupTopPadding: 10,
    groupBottomPadding: 4,
    groupLetterSpacing: 1.2,
    groupColorFactor: 1.4,
    rowPadding: 12,
    rowHorizontalPadding: 8,
    rowSpacing: 10,
    rowTextSpacing: 2,
    valueColorFactor: 1.35,
    iconWidth: 22,
    textReservedWidth: 42
  })

  readonly property var hosts: ({
    desktop: {
      temperature: {
        entity: "sensor.meter_d828_temperature",
        label: "Meter D828 temperature",
        page: "office"
      },
      co2: {
        entity: "sensor.meter_d828_carbon_dioxide",
        label: "Meter D828 CO2"
      },
      airConditionerTarget: {
        entity: "input_number.office_air_conditioner_target_temperature",
        label: "Target temperature",
        presets: [],
        gateEntity: "input_boolean.office_air_conditioner_enabled",
        gateOption: "--gate-state on",
        statusEntity: "climate.office_air_conditioner"
      },
      airConditionerEnabled: {
        entity: "input_boolean.office_air_conditioner_enabled",
        label: "Enabled"
      },
      curtains: {
        entity: "cover.curtain",
        label: "Office curtains"
      },
      blinds: false,
      diningTemperature: false,
      voc: false
    },
    laptop: {
      temperature: {
        entity: "sensor.meter_plus_378b_temperature",
        label: "Living room temperature",
        page: "living-room"
      },
      co2: {
        entity: "sensor.apollo_air_1_806d64_co2",
        label: "Apollo Air 1 CO2"
      },
      airConditionerTarget: {
        entity: "input_number.living_room_air_conditioner_target_temperature",
        label: "Target temperature",
        presets: [
          { label: "22.6", value: 22.6 },
          { label: "22.8", value: 22.8 },
          { label: "23.2", value: 23.2 },
          { label: "23.4", value: 23.4 },
          { label: "23.6", value: 23.6 },
          { label: "23.8", value: 23.8 },
          { label: "24.2", value: 24.2 },
          { label: "24.4", value: 24.4 },
          { label: "Off", value: 36 }
        ],
        gateEntity: "input_number.living_room_air_conditioner_target_temperature",
        gateOption: "--gate-below 26",
        statusEntity: "climate.air_conditioner"
      },
      airConditionerEnabled: false,
      curtains: false,
      blinds: [
        { entity: "cover.living_room_left_blind", label: "Left blind" },
        { entity: "cover.living_room_middle_blind", label: "Middle blind" },
        { entity: "cover.living_room_right_blind", label: "Right blind" }
      ],
      diningTemperature: true,
      voc: true
    }
  })

  readonly property var commonModules: [
    {
      id: "calendar",
      group: "Schedule",
      label: "Calendar",
      icon: "󰃭",
      command: "ha-module-bar current-next-event --entity input_text.current_next_event_in_an_hour --icon 󰃭",
      interval: 30000,
      action: "launch-floating-webapp 'https://calendar.google.com/calendar/u/0/r?pli=1'",
      showWhen: { excludesClasses: ["hidden", "inactive"] },
      emptyHiddenAvailable: true,
      inactiveText: "No upcoming event"
    },
    {
      id: "time-check",
      group: "Status",
      label: "Time check",
      icon: "󱑎",
      stream: true,
      command: "ha-watch-singleton --module time-check --entity input_boolean.time_check --icon 󱑎 --text-on 'Check the time' --tooltip-on 'Time check (input_boolean.time_check): On' --tooltip-off 'Time check (input_boolean.time_check): Off' --class-on active --class-off inactive --hide-off",
      action: "timmo-run-command go-automate ha ib t time_check",
      showWhen: { classes: ["active"] },
      inactiveText: "Off",
      activeText: "On",
      colors: { active: root.colors.purple }
    },
    {
      id: "in-a-call",
      group: "Status",
      label: "In a call",
      icon: "󰍸",
      stream: true,
      command: "ha-watch-singleton --module in-a-call --entity input_boolean.in_a_call --icon '' --tooltip-on 'In a call (input_boolean.in_a_call): On' --tooltip-off 'In a call (input_boolean.in_a_call): Off' --class-on active --class-off inactive --hide-off",
      action: "timmo-run-command go-automate ha ib t in_a_call",
      showWhen: { classes: ["active"] },
      inactiveText: "Off",
      activeText: "On",
      barIconOnly: true,
      colors: { active: root.colors.teal }
    },
    {
      id: "nas",
      group: "Status",
      label: "NAS activity",
      icon: "󰒋",
      command: "ha-module-bar nas-activity --icon 󰒋",
      interval: 5000,
      action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/network?more-info-entity-id=sensor.nas_activity'",
      showWhen: { excludesClasses: ["hidden", "inactive"] },
      hideWhen: { classes: ["hidden"] },
      inactiveText: "Idle",
      colors: { active: root.colors.teal }
    }
  ]

  readonly property var heating: ({
    id: "heating",
    group: "Environment",
    label: "Heating",
    icon: "󰈸",
    stream: true,
    command: "ha-watch-singleton --module heating --entity sensor.thermostat_status --icon 󰈸 --tooltip-on 'Thermostat status (sensor.thermostat_status)' --class-on heating --class-off hidden --hide-off",
    action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/home?more-info-entity-id=sensor.thermostat_status'",
    showWhen: { classes: ["heating"] },
    hideWhen: { classes: ["hidden"] },
    hideUnavailable: true,
    inactiveText: "Off",
    activeText: "On",
    colors: { active: root.colors.orange }
  })

  readonly property var rain: ({
    id: "rain",
    group: "Environment",
    label: "Rain",
    icon: "󰖖",
    stream: true,
    command: "ha-watch-singleton --module rain --entity binary_sensor.weather_station_rain_state_piezo --icon 󰖖 --tooltip-on 'Weather station rain state piezo (binary_sensor.weather_station_rain_state_piezo): Raining' --tooltip-off 'Weather station rain state piezo (binary_sensor.weather_station_rain_state_piezo): Not raining' --class-on raining --class-off hidden --hide-off",
    action: "launch-floating-webapp 'http://homeassistant.local:8123/home/areas-048a0fd33b134e3689eda6212a41b99d?more-info-entity-id=binary_sensor.weather_station_rain_state_piezo'",
    showWhen: { classes: ["raining"] },
    inactiveText: "Clear",
    activeText: "Raining",
    colors: { active: root.colors.blue }
  })

  readonly property var diningTemperature: ({
    id: "dining-temperature",
    group: "Environment",
    label: "Dining room temperature",
    icon: "󰩰",
    command: "ha-module-bar temperature --entity sensor.meter_plus_433c_temperature --name 'Dining room temperature' --icon 󰩰",
    interval: 15000,
    action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/home?more-info-entity-id=sensor.meter_plus_433c_temperature'",
    colors: { quiet: root.colors.cream }
  })

  readonly property var voc: ({
    id: "voc",
    group: "Environment",
    label: "Apollo Air 1 VOC",
    icon: "󰵃",
    command: "ha-module-bar voc-alert --quality-entity sensor.apollo_air_1_806d64_voc_quality --value-entity sensor.apollo_air_1_806d64_sen55_voc --name 'Apollo Air 1 VOC' --icon 󰵃",
    interval: 15000,
    action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/environment?more-info-entity-id=sensor.apollo_air_1_806d64_sen55_voc'",
    showWhen: { classes: ["warning", "critical"] },
    severityClasses: { warning: ["warning"], critical: ["critical"] },
    inactiveText: "Normal",
    colors: { warning: root.colors.tan, critical: root.colors.vocCritical }
  })

  readonly property var doorbell: ({
    id: "doorbell",
    stream: true,
    background: true,
    command: "ha-module-bar doorbell --entity input_boolean.doorbell --stream-key doorbell.input_boolean.doorbell --trigger-state on --trigger-command 'doorbell-popup --open-only --camera-entity camera.front_door_snapshot --no-auto-close' --trigger-on transition --trigger-initial false --trigger-cooldown 2 --trigger-key doorbell.popup.input_boolean.doorbell"
  })

  function definitions(host) {
    var hostConfig = hosts[host] || hosts.laptop
    var modules = commonModules.slice()
    var target = hostConfig.airConditionerTarget
    var airConditioner = {
      id: "air-conditioner",
      group: "Controls",
      subgroup: "Air conditioner",
      label: "Status",
      icon: "󰾅",
      stream: true,
      panelOnly: true,
      command: "go-automate ha climate watch "
        + target.statusEntity.slice("climate.".length),
      action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/"
        + hostConfig.temperature.page + "?more-info-entity-id=" + target.statusEntity + "'",
      actionLayout: "grid",
      actionColumns: 2,
      actions: [
        {
          id: "fan-low",
          label: "Low",
          command: "timmo-run-command go-automate ha climate fan-mode "
            + target.statusEntity.slice("climate.".length) + " 1"
        },
        {
          id: "fan-high",
          label: "High",
          command: "timmo-run-command go-automate ha climate fan-mode "
            + target.statusEntity.slice("climate.".length) + " 2"
        }
      ],
      unavailableClasses: ["unavailable"],
      hideUnavailable: true,
      colors: { quiet: colors.teal }
    }
    var outdoorTemperature = {
      id: "outdoor-temperature",
      group: "Environment",
      label: "Outdoor temperature",
      icon: "󰖙",
      command: "ha-module-bar temperature --entity sensor.weather_station_outdoor_temperature"
        + " --name 'Weather station outdoor temperature' --icon 󰖙 --show-above 23"
        + " --gate-entity " + target.gateEntity + " " + target.gateOption,
      interval: 15000,
      action: "launch-floating-webapp 'http://homeassistant.local:8123/home?more-info-entity-id=weather.met_office&more-info-view=info#forecast=hourly'",
      colors: { quiet: colors.orange }
    }
    var airConditionerTargetStatus = {
      id: "air-conditioner-target-status",
      group: "Environment",
      label: target.label,
      icon: "󰾅",
      command: "ha-module-bar dining-temperature --entity " + target.entity
        + " --name '" + target.label + "' --icon 󰾅 --gate-entity " + target.gateEntity
        + " " + target.gateOption + " --status-entity " + target.statusEntity
        + " --active-state cool",
      interval: 15000,
      barOnly: true,
      action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/"
        + hostConfig.temperature.page + "?more-info-entity-id=" + target.entity + "'",
      hideUnavailable: true,
      severityClasses: { active: ["active"] },
      colors: { quiet: colors.fadedBlue, active: colors.blue }
    }
    var airConditionerTargetTemperature = {
      id: "air-conditioner-target-temperature",
      group: "Controls",
      subgroup: "Air conditioner",
      label: target.label,
      icon: "󰾅",
      command: "ha-module-bar dining-temperature --entity " + target.entity
        + " --name '" + target.label + "' --icon 󰾅",
      interval: 15000,
      panelOnly: true,
      control: "number",
      decrementCommand: "timmo-run-command go-automate ha input_number decrement "
        + target.entity.slice("input_number.".length),
      incrementCommand: "timmo-run-command go-automate ha input_number increment "
        + target.entity.slice("input_number.".length),
      setValueCommand: "timmo-run-command go-automate ha input_number set-value "
        + target.entity.slice("input_number.".length) + " ",
      presets: target.presets,
      hideUnavailable: true,
      colors: { quiet: colors.fadedBlue }
    }
    var airConditionerEnabled = hostConfig.airConditionerEnabled ? {
      id: "air-conditioner-enabled",
      group: "Controls",
      subgroup: "Air conditioner",
      label: hostConfig.airConditionerEnabled.label,
      icon: "󰾅",
      stream: true,
      panelOnly: true,
      control: "toggle",
      command: "ha-watch-singleton --module air-conditioner-enabled --entity "
        + hostConfig.airConditionerEnabled.entity
        + " --icon '' --class-on active --class-off inactive",
      toggleCommand: "timmo-run-command go-automate ha input_boolean toggle "
        + hostConfig.airConditionerEnabled.entity.slice("input_boolean.".length),
      inactiveText: "Off",
      activeText: "On",
      severityClasses: { active: ["active"] },
      colors: { quiet: colors.fadedBlue, active: colors.orange }
    } : null
    var temperature = {
      id: "temperature",
      group: "Environment",
      label: hostConfig.temperature.label,
      icon: "󰔏",
      command: "ha-module-bar temperature --entity " + hostConfig.temperature.entity
        + " --name '" + hostConfig.temperature.label + "' --icon 󰔏",
      interval: 15000,
      action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/"
        + hostConfig.temperature.page + "?more-info-entity-id=" + hostConfig.temperature.entity + "'",
      colors: { quiet: colors.cream }
    }
    var co2 = {
      id: "co2",
      group: "Environment",
      label: hostConfig.co2.label,
      icon: "󰟤",
      command: "ha-module-bar co2-alert --entity " + hostConfig.co2.entity
        + " --name '" + hostConfig.co2.label + "' --icon 󰟤",
      interval: 15000,
      action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/environment?more-info-entity-id="
        + hostConfig.co2.entity + "'",
      showWhen: { classes: ["warning", "critical"] },
      severityClasses: { warning: ["warning"], critical: ["critical"] },
      inactiveText: "Normal",
      colors: { warning: colors.orange, critical: colors.co2Critical }
    }
    var curtains = hostConfig.curtains ? {
      id: "office-curtains",
      group: "Controls",
      label: hostConfig.curtains.label,
      icon: "󰡆",
      stream: true,
      panelOnly: true,
      command: "ha-watch-singleton --module office-curtains --entity "
        + hostConfig.curtains.entity,
      action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/office?more-info-entity-id="
        + hostConfig.curtains.entity + "'",
      actionLayout: "grid",
      actions: [
        {
          id: "close",
          label: "Close",
          position: 0,
          command: "timmo-run-command go-automate ha cover close curtain"
        },
        {
          id: "position-10",
          label: "10%",
          position: 10,
          command: "timmo-run-command go-automate ha cover position curtain 10"
        },
        {
          id: "position-20",
          label: "20%",
          position: 20,
          command: "timmo-run-command go-automate ha cover position curtain 20"
        },
        {
          id: "position-30",
          label: "30%",
          position: 30,
          command: "timmo-run-command go-automate ha cover position curtain 30"
        },
        {
          id: "position-60",
          label: "60%",
          position: 60,
          command: "timmo-run-command go-automate ha cover position curtain 60"
        }
      ],
      colors: { quiet: colors.teal }
    } : null
    var blinds = []
    if (hostConfig.blinds) {
      var blindPositions = [0, 20, 40, 60, 80, 100]
      for (var blindIndex = 0; blindIndex < hostConfig.blinds.length; blindIndex++) {
        var blind = hostConfig.blinds[blindIndex]
        var blindActions = []
        for (var positionIndex = 0; positionIndex < blindPositions.length; positionIndex++) {
          var position = blindPositions[positionIndex]
          blindActions.push({
            id: "tilt-" + position,
            label: position + "%",
            command: "timmo-run-command go-automate ha cover tilt-position "
              + blind.entity.slice("cover.".length) + " " + position
          })
        }
        blinds.push({
          id: "living-room-blind-" + blindIndex,
          group: "Controls",
          label: blind.label,
          icon: "",
          stream: true,
          panelOnly: true,
          command: "ha-watch-singleton --module living-room-blind-" + blindIndex
            + " --entity " + blind.entity,
          action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/living-room?more-info-entity-id="
            + blind.entity + "'",
          actionLayout: "grid",
          actionColumns: 6,
          compactActions: true,
          actions: blindActions,
          colors: { quiet: colors.teal }
        })
      }
    }
    modules.push(outdoorTemperature)
    modules.push(rain)
    modules.push(airConditionerTargetStatus)
    modules.push(heating)
    modules.push(co2)
    if (hostConfig.voc) modules.push(voc)
    modules.push(temperature)
    if (hostConfig.diningTemperature) modules.push(diningTemperature)
    var controls = []
    if (curtains) controls.push(curtains)
    controls = controls.concat(blinds)
    controls.push(airConditioner)
    controls.push(airConditionerTargetTemperature)
    if (airConditionerEnabled) controls.push(airConditionerEnabled)
    modules = controls.concat(modules)
    modules.push(doorbell)
    return modules
  }
}

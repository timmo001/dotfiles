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
    maxHeight: 620,
    contentSpacing: 2,
    titleBottomPadding: 8,
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
        label: "Meter D828 Temperature",
        page: "office"
      },
      co2: {
        entity: "sensor.meter_d828_carbon_dioxide",
        label: "Meter D828 CO2"
      },
      airConditionerTarget: {
        entity: "input_number.office_air_conditioner_target_temperature",
        label: "Office Air Conditioner Target Temperature",
        gateEntity: "input_boolean.office_air_conditioner_enabled",
        gateOption: "--gate-state on",
        statusEntity: "climate.office_air_conditioner"
      },
      diningTemperature: false,
      voc: false
    },
    laptop: {
      temperature: {
        entity: "sensor.meter_plus_378b_temperature",
        label: "Meter Plus Temperature",
        page: "living-room"
      },
      co2: {
        entity: "sensor.apollo_air_1_806d64_co2",
        label: "Apollo Air 1 CO2"
      },
      airConditionerTarget: {
        entity: "input_number.living_room_air_conditioner_target_temperature",
        label: "Living Room Air Conditioner Target Temperature",
        gateEntity: "input_number.living_room_air_conditioner_target_temperature",
        gateOption: "--gate-below 26",
        statusEntity: "climate.air_conditioner"
      },
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
      label: "Time Check",
      icon: "󱑎",
      stream: true,
      command: "ha-watch-singleton --module time-check --entity input_boolean.time_check --icon 󱑎 --text-on 'Check the time' --tooltip-on 'Time Check (input_boolean.time_check): On' --tooltip-off 'Time Check (input_boolean.time_check): Off' --class-on active --class-off inactive --hide-off",
      action: "timmo-run-command go-automate ha ib t time_check",
      showWhen: { classes: ["active"] },
      inactiveText: "Off",
      activeText: "On",
      colors: { active: root.colors.purple }
    },
    {
      id: "in-a-call",
      group: "Status",
      label: "In a Call",
      icon: "󰍸",
      stream: true,
      command: "ha-watch-singleton --module in-a-call --entity input_boolean.in_a_call --icon '' --tooltip-on 'In a Call (input_boolean.in_a_call): On' --tooltip-off 'In a Call (input_boolean.in_a_call): Off' --class-on active --class-off inactive --hide-off",
      action: "timmo-run-command go-automate ha ib t in_a_call",
      showWhen: { classes: ["active"] },
      inactiveText: "Off",
      activeText: "On",
      colors: { active: root.colors.teal }
    },
    {
      id: "nas",
      group: "Status",
      label: "NAS Activity",
      icon: "󰒋",
      command: "ha-module-bar nas-activity --icon 󰒋",
      interval: 5000,
      action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/network?more-info-entity-id=sensor.nas_activity'",
      showWhen: { excludesClasses: ["hidden", "inactive"] },
      inactiveText: "Idle",
      colors: { active: root.colors.teal }
    }
  ]

  readonly property var outdoorTemperature: ({
    id: "outdoor-temperature",
    group: "Environment",
    label: "Outdoor Temperature",
    icon: "󰖙",
    command: "ha-module-bar temperature --entity sensor.weather_station_outdoor_temperature --name 'Weather Station Outdoor Temperature' --icon 󰖙 --show-above 25",
    interval: 15000,
    action: "launch-floating-webapp 'http://homeassistant.local:8123/home?more-info-entity-id=weather.met_office&more-info-view=info#forecast=hourly'",
    colors: { quiet: root.colors.orange }
  })

  readonly property var heating: ({
    id: "heating",
    group: "Environment",
    label: "Heating",
    icon: "󰈸",
    stream: true,
    command: "ha-watch-singleton --module heating --entity sensor.thermostat_status --icon 󰈸 --tooltip-on 'Thermostat Status (sensor.thermostat_status)' --class-on heating --class-off hidden --hide-off",
    action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/home?more-info-entity-id=sensor.thermostat_status'",
    showWhen: { classes: ["heating"] },
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
    command: "ha-watch-singleton --module rain --entity binary_sensor.weather_station_rain_state_piezo --icon 󰖖 --tooltip-on 'Weather Station Rain State Piezo (binary_sensor.weather_station_rain_state_piezo): Raining' --tooltip-off 'Weather Station Rain State Piezo (binary_sensor.weather_station_rain_state_piezo): Not raining' --class-on raining --class-off hidden --hide-off",
    action: "launch-floating-webapp 'http://homeassistant.local:8123/home/areas-048a0fd33b134e3689eda6212a41b99d?more-info-entity-id=binary_sensor.weather_station_rain_state_piezo'",
    showWhen: { classes: ["raining"] },
    inactiveText: "Clear",
    activeText: "Raining",
    colors: { active: root.colors.blue }
  })

  readonly property var diningTemperature: ({
    id: "dining-temperature",
    group: "Environment",
    label: "Dining Room Temperature",
    icon: "󰩰",
    command: "ha-module-bar temperature --entity sensor.meter_plus_433c_temperature --name 'Dining Room Temperature' --icon 󰩰",
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
    var airConditionerTargetTemperature = {
      id: "air-conditioner-target-temperature",
      group: "Environment",
      label: target.label,
      icon: "󰾅",
      command: "ha-module-bar dining-temperature --entity " + target.entity
        + " --name '" + target.label + "' --icon 󰾅 --gate-entity " + target.gateEntity
        + " " + target.gateOption + " --status-entity " + target.statusEntity
        + " --active-state cool",
      interval: 15000,
      action: "launch-floating-webapp 'http://homeassistant.local:8123/lovelace/home?more-info-entity-id="
        + target.entity + "'",
      hideUnavailable: true,
      severityClasses: { active: ["active"] },
      colors: { quiet: colors.fadedBlue, active: colors.blue }
    }
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
    modules.push(outdoorTemperature)
    modules.push(airConditionerTargetTemperature)
    modules.push(heating)
    if (hostConfig.voc) modules.push(voc)
    modules.push(co2)
    modules.push(rain)
    modules.push(temperature)
    if (hostConfig.diningTemperature) modules.push(diningTemperature)
    modules.push(doorbell)
    return modules
  }
}

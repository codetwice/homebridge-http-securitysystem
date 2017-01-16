# homebridge-http-securitysystem
Homebridge plugin that creates a SecuritySystem device which uses configurable HTTP calls to set and get its state.

This plugin can be used as a security system in HomeKit/Homebridge. It creates a Homebridge accessory which uses HTTP calls to arm, disarm and check the status of security systems 
and provides the Service.SecuritySystem service to HomeKit with both the SecuritySystemCurrentState and the SecuritySystemTargetState characteristics implemented.

## Installation

1. Install homebridge using: npm install -g homebridge
2. Install homebridge-http-securitysystem using: npm install -g homebridge-http-securitysystem
3. Update your configuration file. See sample-config.json in this repository for a sample. 

## Configuration
This module requires that the URLs for getting and setting the security system's state are configured correctly. This has to be done in Homebridge's config.json. 
You can find a sample configuration file in this repository. 

The configuration options are the following:

Configuration example with explanation

```
    "accessories": [
        {
            "accessory": "Http-SecuritySystem",
            "name": "Home security",
            "username": "",
            "password": "",
            "immediately": false
            "http_method": "GET",
            "urls": {
                "stay": { "url": "http://localhost:1880/alarm/arm/stay", "body": "" },
                "away": { "url": "http://localhost:1880/alarm/arm/away", "body": "" },
                "night": { "url": "http://localhost:1880/alarm/arm/night", "body": "" },
                "disarm": { "url": "http://localhost:1880/alarm/disarm", "body": "" },
                "readCurrentState": { "url": "http://localhost:1880/alarm/check", "body": "" },
                "readTargetState": { "url": "http://localhost:1880/alarm/check", "body": "" }
            }
        }
    ]

```

- The **name** parameter determines the name of the security system you will see in HomeKit.
- The **username/password** configuration can be used to specify the username and password if the remote webserver requires HTTP authentication. 
- The **http_method** can be either "GET" or "POST". The HTTP requests going to the target webserver will be using this method.
- The **urls section** configures the URLs that are to be called on certain events. 
  - The **stay**, **away** and **night** URLs are called when HomeKit is instructed to arm the alarm (it has 3 different alarm on states)
  - The **disarm** URL is used when HomeKit is instructed to disarm the alarm
  - The **readCurrentState** and **readTargetState** are used by HomeKit for querying the current state of the alarm device. It should return the following values in the body of the HTTP response:
    - **"0"**: stay armed
    - **"1"**: away armed
    - **"2"**: night armed
    - **"3"**: disarmed
    - **"4"**: alarm has been triggered


# homebridge-http-securitysystem
Homebridge plugin that creates a SecuritySystem device which uses configurable HTTP calls to set and get its state.

It's main purpose is to connect security solutions that are not HomeKit compatible to HomeKit. 

This plugin can be used as a security system in HomeKit/Homebridge. It creates a Homebridge accessory which uses HTTP calls to arm, disarm and check the status of security systems 
and provides the Service.SecuritySystem service to HomeKit with both the SecuritySystemCurrentState and the SecuritySystemTargetState characteristics implemented.

## Installation

1. Install homebridge using: npm install -g homebridge
2. Install homebridge-http-securitysystem using: npm install -g homebridge-http-securitysystem
3. Update your configuration file. See sample-config.json in this repository for a sample. 

## Features
The main function of the module is to proxy HomeKit queries to an arbitrary web API to retrieve and set the status of the security system. Main features include:
- Configurable HTTP endpoints to use for getting/setting the state, including passing parameters in for of GET or in POST body
- Support for basic HTTP authentication
- Configurable mapping of API response data to HomeKit SecurityDevice status to allow custom responses
- Interval polling of the current state to enable real-time notifications even if the security system has been enabled without the use of HomeKit

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
            "debug": false,
            "username": "",
            "password": "",
            "immediately": false,
            "polling": true,
            "pollInterval": 30000,
            "http_method": "POST",
            "urls": {
                "stay": { "url": "http://localhost:1880/alarm/arm", "body": "stay" },
                "away": { "url": "http://localhost:1880/alarm/arm", "body": "away" },
                "night": { "url": "http://localhost:1880/alarm/arm", "body": "night" },
                "disarm": { "url": "http://localhost:1880/alarm/disarm", "body": "" },
                "readCurrentState": { "url": "http://localhost:1880/alarm/check", "body": "" },
                "readTargetState": { "url": "http://localhost:1880/alarm/check", "body": "", "headers": { "Content-Type", "application/json" } }
            },
            "mappers": [
                {
                    "type": "xpath",
                    "parameters": {
                        "xpath": "//partition[3]/text()"
                    }
                },
                {
                    "type": "regex",
                    "parameters": {
                        "regexp": "^The system is currently (ARMED|DISARMED), yo!$",
                        "capture": "1"
                    }
                },
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "ARMED": "0",
                            "DISARMED": "3"
                        }
                    }
                }
            ]
        }
    ]

```

- The **name** parameter determines the name of the security system you will see in HomeKit.
- The **username/password** configuration can be used to specify the username and password if the remote webserver requires HTTP authentication. 
- **debug** turns on debug messages. The important bit is that it reports the mapping process so that it's easier to debug
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
  - if you need to call multiple URLs for changing the state, you can pass in an array of URL definitions instead of a single object
- The **polling** is a boolean that specifies if the current state should be pulled on regular intervals or not. Defaults to false.
- **pollInterval** is a number which defines the poll interval in milliseconds. Defaults to 30000.
- The **mappings** optional parameter allows the definition of several response mappers. This can be used to translate the response received by readCurrentState and readTargetState to the expect 0...4 range expected by homekit

## URL configuration
When defining URLs in the config, you have to the URL to hit and the body to post to that URL (which can be empty of course). An URL definition can be:
- either a single configuration object
- or an array of configuration objects

Each configuration object has the following properties:
- **url**: the URL to hit
- **body**: the request body to send to the URL (optional)
- **headers**: an object, of which the property-value pairs will be sent as HTTP headers.

Multiple endpoints are only supported for the setTargetState endpoint. The other calls always go to a single URL only.

## Response mapping
The mappings block of the configuration may contain any number of mapper definitions. The mappers are chained after each other,  the result of a mapper is fed into the input of the next mapper. The purpose of this whole chain is to somehow boil down the response received from the API to a single number which is expected by Homekit. 

Each mapper has the following JSON format:

```
{
    "type": "<type of the mapper>",
    "parameters": { <parameters to be passed to the mapper> }
}
```

There are 3 kinds of mappers implemented at the moment. 

### Static mapper

The static mapper can be used to define a key => value dictionary. It will simply look up the input in the dictionary and if it is found, it returns the corresponding value. It's great for mapping string responses like "ARMED" to their actual number. 

Configuration is as follows:

```
{
    "type": "static",
    "parameters": { 
        "mapping": {
            "STAY": "0",
            "AWAY": "1",
            "whataever you don't like": "whatever you like more"
        }
    }
}
```

This configuration would map STAY to 0, AWAY to 1 and "whatever you don't like" to "whatever you like more". If the mapping does not have an entry which corresponds to input, it returns the full input. 

### Regexp mapper

The regexp mapper can be used to define a regular expression to run on the input, capture some substring of it and return it. It's great for mapping string responses which may change around but have a certain part that's always there and which is the part you are interested in. 

Configuration is as follows:

```
{
    "type": "regex",
    "parameters": {
        "regexp": "^The system is currently (ARMED|DISARMED), yo!$",
        "capture": "1"
    }
}
```

This configuration will run the regular expression defined by the ***regexp*** parameter against the input and return the first capture group (as defined by ***capture***). So, in this case, if the input is "The system is currenty ARMED, yo!", the mapper will map this to "ARMED".

If the regexp does not match the input, the mapper returns the full input. 

### XPath mapper

The XPath mapper can be used to extract data from an XML document. It allows the definition of an XPath which will then be applied to the input and returns whatever the query selects. 

When using this mapper, make sure that you select text elements and not entire nodes or node lists, otherwise it will fail horribly.

Configuration is as follows:

```
{
    "type": "xpath",
    "parameters": {
        "xpath": "//partition[3]/text()",
        "index": 0
    }
}
```

Let's assume this mapper gets the following input:

```
<?xml version="1.0" encoding="ISO-8859-1"?>
<partitionsStatus>
    <partition>ARMED</partition>
    <partition>ARMED</partition>
    <partition>ARMED_IMMEDIATE</partition>
</partitionsStatus>
```

In this case this mapper will return "ARMED_IMMEDIATE". The ***index*** parameter can be used to specify which element to return if the xpath selects multiple elements. In the example above it is completely redundant as partition[3] already makes sure that a single partition is selected. 

var Service, Characteristic;
var request = require("request");
var xpath = require("xpath");
var dom = require("xmldom").DOMParser;
var pollingtoevent = require("polling-to-event");
var _ = require("lodash");

module.exports = function(homebridge){
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory("homebridge-http-securitysystem", "Http-SecuritySystem", HttpSecuritySystemAccessory);
};

/**
 * Mapper class that can be used as a dictionary for mapping one value to another
 *
 * @param {Object} parameters The parameters of the mapper
 * @constructor
 */
function StaticMapper(parameters) {
	var self = this;
	self.mapping = parameters.mapping;

	self.map = function(value) {
		return self.mapping[value] || value;
	};
}

/**
 * Mapper class that can extract a part of the string using a regex
 *
 * @param {Object} parameters The parameters of the mapper
 * @constructor
 */
function RegexMapper(parameters) {
	var self = this;
	self.regexp = new RegExp(parameters.regexp);
	self.capture = parameters.capture || "1";

	self.map = function(value) {
		var matches = self.regexp.exec(value);

		if (matches !== null && self.capture in matches) {
			return matches[self.capture];
		}

		return value;
	};
}

/**
 * Mapper class that uses XPath to select the text of a node or the value of an attribute
 *
 * @param {Object} parameters The parameters of the mapper
 * @constructor
 */
function XPathMapper(parameters) {
	var self = this;
	self.xpath = parameters.xpath;
	self.index = parameters.index || 0;

	self.map = function(value) {
		var document = new dom().parseFromString(value);
		var result  = xpath.select(this.xpath, document);

		if (typeof result == "string") {
			return result;
		} else if (result instanceof Array && result.length > self.index) {
			return result[self.index].data;
		}

		return value;
	};
}

/**
 * The main class acting as the Security System Accessory
 *
 * @param log The logger to use
 * @param config The config received from HomeBridge
 * @constructor
 */
function HttpSecuritySystemAccessory(log, config) {
	var self = this;
	self.log = log;
	self.name = config["name"];

	// the service
	self.securityService = null;

	// debug flag
	self.debug = config.debug;

	// polling settings
	self.polling = config.polling;
	self.pollInterval = config.pollInterval || 30000;

	// cached values
	self.previousCurrentState = null;
	self.previousTargetState = null;

	// process the mappers
	self.mappers = [];
	if (config.mappers) {
		config.mappers.forEach(function(matches) {
			switch (matches.type) {
				case "regex":
					self.mappers.push(new RegexMapper(matches.parameters));
					break;
				case "static":
					self.mappers.push(new StaticMapper(matches.parameters));
					break;
				case "xpath":
					self.mappers.push(new XPathMapper(matches.parameters));
					break;
			}
		});
	}

	// url info
	self.urls = {
		stay: { url: '', body: '' },
		away: { url: '', body: '' },
		night: { url: '', body: '' },
		disarm: { url: '', body: '' },
		readCurrentState: { url: '', body: '' },
		readTargetState: { url: '', body: '' }
	};

	_.merge(self.urls, config.urls);

	self.httpMethod = config["http_method"] || "GET";
	self.auth = {
		username: config.username || "",
		password: config.password || "",
		immediately: true
	};

	if ("immediately" in config) {
		self.auth.immediately = config.immediately;
	}

	// initialize
	self.init();
}

/**
 * Initializer method, fired after the config has been applied
 */
HttpSecuritySystemAccessory.prototype.init = function() {
	var self = this;

	// set up polling if requested
	if (self.polling) {
		self.log("Starting polling with an interval of %s ms", self.pollInterval);

		var emitterConfig = [
			{
				method: self.getCurrentState.bind(this),
				property: 'current state',
				characteristic: Characteristic.SecuritySystemCurrentState
			},
			{
				method: self.getTargetState.bind(this),
				property: 'target state',
				characteristic: Characteristic.SecuritySystemTargetState
			}
		];

		emitterConfig.forEach(config => {
			var emitter = pollingtoevent(function(done) {
				config.method(function (err, result) {
					done(err, result);
				});
			}, { longpolling: true, interval: self.pollInterval });

			emitter.on("longpoll", function(state) {
				self.log('Polling noticed %s change to %s, notifying devices', config.property, state);
				self.securityService
						.getCharacteristic(config.characteristic)
						.setValue(state);
			});

			emitter.on("error", function(err) {
				self.log("Polling of %s failed, error was %s", config.property, err);
			});
		});
	}
};

/**
 * Method that performs a HTTP request
 *
 * @param {String} url The URL to hit
 * @param {String} body The body of the request
 * @param {Object} headers The HTTP headers to pass along the request
 * @param {Function} callback Callback method to call with the result or error (error, response, body)
 */
HttpSecuritySystemAccessory.prototype.httpRequest = function(url, body, headers, callback) {
	var params = {
		url: url,
		body: body,
		method: this.httpMethod,
		auth: {
			user: this.auth.username,
			pass: this.auth.password,
			sendImmediately: this.auth.immediately
		},
		headers: {}
	};

	if (this.auth.username) {
		_.merge(params.headers, {
			'Authorization': 'Basic ' + new Buffer(this.auth.username + ':' + this.auth.password).toString('base64')
		});
	}

	if (headers != null) {
		_.merge(params.headers, headers);
	}

	request(params, function(error, response, body) {
		callback(error, response, body)
	});
};

/**
 * Logs a message to the HomeBridge log
 *
 * Only logs the message if the debug flag is on.
 */
HttpSecuritySystemAccessory.prototype.debugLog = function () {
	if (this.debug) {
		this.log.apply(this, arguments);
	}
};

/**
 * Sets the target state of the security device to a given state
 *
 * @param state The state to set
 * @param callback Callback to call with the result
 */
HttpSecuritySystemAccessory.prototype.setTargetState = function(state, callback) {
	this.log("Setting state to %s", state);
	var cfg = null;
	switch (state) {
		case Characteristic.SecuritySystemTargetState.STAY_ARM:
			cfg = this.urls.stay;
			break;
		case Characteristic.SecuritySystemTargetState.AWAY_ARM :
			cfg = this.urls.away;
			break;
		case Characteristic.SecuritySystemTargetState.NIGHT_ARM:
			cfg = this.urls.night;
			break;
		case Characteristic.SecuritySystemTargetState.DISARM:
			cfg = this.urls.disarm;
			break;
	}

	// if the URL is not configured, do not do anything
	if (cfg == null) {
		callback(null);
	}

	// if the config is not an array, convert it to one
	if (!(cfg instanceof Array)) {
		cfg = [ cfg ];
	}

	// call all urls and fire the callbacks when all URLs have returned something
	var errorToReport = null;
	var responses = 0;

	cfg.forEach(c => {
		var url = c.url;
		var body = c.body || '';
		var headers = c.headers || {}
		this.httpRequest(url, body, headers, function(error, response) {
			responses++;
			if (error) {
				this.log("SetState function failed (%s returned %s)", url, error.message);
				errorToReport = error;
				callback(error);
			} else {
				this.log("SetState function succeeded (%s)", url);
			}

			if (responses == cfg.length) {
				callback(errorToReport, response, state);
				this.refreshCurrentState();
			}
		}.bind(this));
	});
};

/**
 * Applies the mappers to the state string received
 *
 * @param {string} string The string to apply the mappers to
 * @returns {string} The modified string after all mappers have been applied
 */
HttpSecuritySystemAccessory.prototype.applyMappers = function(string) {
	var self = this;

	if (self.mappers.length > 0) {
		self.debugLog("Applying mappers on " + string);
		self.mappers.forEach(function (mapper, index) {
			var newString = mapper.map(string);
			self.debugLog("Mapper " + index + " mapped " + string + " to " + newString);
			string = newString;
		});

		self.debugLog("Mapping result is " + string);
	}

	return string;
};

/**
 * Gets the state of the security system from a given URL
 *
 * @param {Object} requestConfig The HTTP request configuration
 * @param {Function} callback The method to call with the results
 */
HttpSecuritySystemAccessory.prototype.getState = function(requestConfig, callback) {
	// if the URL is not configured, do not do anything
	if (requestConfig == null) {
		callback(null);
	}

	var url = requestConfig.url;
	var body = requestConfig.body || '';
	var headers = requestConfig.headers || {}

	if (!url) {
		callback(null);
	}

	this.httpRequest(url, body, headers, function(error, response, responseBody) {
		if (error) {
			this.log("getState function failed: %s", error.message);
			callback(error);
		} else {
			var state = responseBody;
			state = this.applyMappers(state);
			callback(null, parseInt(state));
		}
	}.bind(this));
};

/**
 * Gets the current state of the security system
 *
 * @param {Function} callback The method to call with the results
 */
HttpSecuritySystemAccessory.prototype.getCurrentState = function(callback) {
	var self = this;
	self.debugLog("Getting current state");
	this.getState(this.urls.readCurrentState, function(err, state) {
		if (!err) {
			self.debugLog("Current state is %s", state);
			if (self.previousCurrentState !== state) {
				self.previousCurrentState = state;
				self.log("Current state changed to %s", state);
			}
		}

		callback(err, state);
	});
};

/**
 * Gets the target state of the security system
 *
 * @param {Function} callback The method to call with the results
 */
HttpSecuritySystemAccessory.prototype.getTargetState =  function(callback) {
	var self = this;
	self.debugLog("Getting target state");

	this.getState(this.urls.readTargetState, function(err, state) {
		if (!err) {
			self.debugLog("Target state is %s", state);
			if (self.previousTargetState !== state) {
				self.previousTargetState = state;
				self.log("Target state changed to %s", state);
			}
		}

		callback(err, state);
	});
};

/**
 * Refreshes the current state of the security system
 *
 * This method forces the plugin to request the current state of the security system and broadcasts it to all listeners.
 */
HttpSecuritySystemAccessory.prototype.refreshCurrentState = function() {
	this.getCurrentState((err, state) => {
		if (!err) {
			this.securityService
					.getCharacteristic(Characteristic.SecuritySystemCurrentState)
					.setValue(state);
		}
	});
}

/**
 * Identifies the security device (?)
 *
 * @param {Function} callback The method to call with the results
 */
HttpSecuritySystemAccessory.prototype.identify = function(callback) {
	this.log("Identify requested!");
	callback();
};

/**
 * Returns the services offered by this security device
 *
 * @returns {Array} The services offered
 */
HttpSecuritySystemAccessory.prototype.getServices =  function() {
	this.securityService = new Service.SecuritySystem(this.name);

	this.securityService
			.getCharacteristic(Characteristic.SecuritySystemCurrentState)
			.on("get", this.getCurrentState.bind(this));

	this.securityService
			.getCharacteristic(Characteristic.SecuritySystemTargetState)
			.on("get", this.getTargetState.bind(this))
			.on("set", this.setTargetState.bind(this));

	return [ this.securityService ];
};

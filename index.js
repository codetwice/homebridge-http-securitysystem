var Service, Characteristic;
var request = require("request");
var xpath = require("xpath.js");
var dom = require("xmldom").DOMParser;

module.exports = function(homebridge){
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory("homebridge-http-securitysystem", "Http-SecuritySystem", HttpSecuritySystemAccessory);
};

function StaticMapper(parameters) {
	var self = this;
	self.mapping = parameters.mapping;

	self.map = function(value) {
		return self.mapping[value] || value;
	};
}

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

function XPathMapper(parameters) {
	var self = this;
	self.xpath = parameters.xpath;
	self.index = parameters.index || 0;

	self.map = function(value) {
		var document = new dom().parseFromString(value);
		var nodes = xpath(document, this.xpath);
		if (nodes.length > self.index) {
			return nodes[self.index].data;
		}

		return value;
	};
}

function HttpSecuritySystemAccessory(log, config) {
	var self = this;
	self.log = log;
	self.name = config["name"];

	// debug flag
	self.debug = !!config.debug;

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
		stay: {
			url: config.urls.stay.url,
			body: config.urls.stay.body || ""
		},
		away: {
			url: config.urls.away.url,
			body: config.urls.away.body || ""
		},
		night: {
			url: config.urls.night.url,
			body: config.urls.night.body || ""
		},
		disarm: {
			url: config.urls.disarm.url,
			body: config.urls.disarm.body || ""
		},
		readCurrentState: {
			url: config.urls.readCurrentState.url,
			body: config.urls.readCurrentState.body || ""
		},
		readTargetState: {
			url: config.urls.readTargetState.url,
			body: config.urls.readTargetState.body || ""
		}
	};

	self.httpMethod = config["http_method"] || "GET";
	self.auth = {
		username: config.username || "",
		password: config.password || "",
		immediately: true
	};

	if ("immediately" in config) {
		self.auth.immediately = config.immediately;
	}
}

HttpSecuritySystemAccessory.prototype = {
	httpRequest: function(url, body, callback) {
		request({
				url: url,
				body: body,
				method: this.httpMethod,
				auth: {
					user: this.auth.username,
					pass: this.auth.password,
					sendImmediately: this.auth.immediately
				},
				headers: {
					Authorization: "Basic " + new Buffer(this.auth.username + ":" + this.auth.password).toString("base64")
				}
			},
			function(error, response, body) {
				callback(error, response, body)
			})
	},
	debugLog: function(message) {
		if (this.debug) {
			this.log(message);
		}
	},
	setTargetState: function(state, callback) {
		this.log("Setting state to %s", state);
		var self = this;
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

		var url = cfg.url;
		var body = cfg.body;
		if (url) {
			this.httpRequest(url, body, function(error, response) {
				if (error) {
					this.log("SetState function failed: %s", error.message);
					callback(error);
				} else {
					this.log("SetState function succeeded!");
					self.securityService.setCharacteristic(Characteristic.SecuritySystemCurrentState, state);
					callback(error, response, state);
				}
			}.bind(this));
		} else {
			callback(null);
		}
	},
	applyMappers: function(state) {
		var self = this;
		self.debugLog("Applying mappers on " + state);
		self.mappers.forEach(function(mapper, index) {
			var newState = mapper.map(state);
			self.debugLog("Mapper " + index + " mapped " + state + " to " + newState);
			state = newState;
		});

		self.debugLog("Mapping result is " + state);
		return state;
	},
	getState: function(url, body, callback) {
		if (!url) {
			callback(null);
		}

		this.httpRequest(url, body, function(error, response, responseBody) {
			if (error) {
				this.log("GetState function failed: %s", error.message);
				callback(error);
			} else {
				var state = parseInt(responseBody);
				state = this.applyMappers(state);
				this.log("State is currently %s", state);
				callback(null, state);
			}
		}.bind(this));
	},
	getCurrentState: function(callback) {
		this.log("Getting current state");
		this.getState(this.urls.readCurrentState.url, this.urls.readCurrentState.body, callback);
	},
	getTargetState: function(callback) {
		this.log("Getting target state");
		this.getState(this.urls.readTargetState.url, this.urls.readTargetState.body, callback);
	},
	identify: function(callback) {
		this.log("Identify requested!");
		callback();
	},
	getServices: function() {
		this.securityService = new Service.SecuritySystem(this.name);

		this.securityService
			.getCharacteristic(Characteristic.SecuritySystemCurrentState)
			.on("get", this.getCurrentState.bind(this));

		this.securityService
			.getCharacteristic(Characteristic.SecuritySystemTargetState)
			.on("get", this.getTargetState.bind(this))
			.on("set", this.setTargetState.bind(this));

		return [ this.securityService ];
	}
};

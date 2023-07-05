//v2.4 custom

/*
options:
write //set common write variable to true
forceIndex //instead of trying to find names for array entries, use the index as the name
channelName //set name of the root channel
preferedArrayName //set key to use this as an array entry name
preferedArrayDec //set key to use this as an array entry description
autoCast (true false) // make JSON.parse to parse numbers correctly
descriptions: Object of names for state keys
states: Object of states to create for an id, new entries via json will be added automatically to the states
parseBase64: (true false) // parse base64 encoded strings to utf8
parseBase64byIds: Array of ids to parse base64 encoded strings to utf8
deleteBeforeUpdate: Delete channel before update,
removePasswords: (true false) // remove password from log
*/
const JSONbig = require("json-bigint")({ storeAsString: true });
module.exports = class Json2iob {
  constructor(adapter) {
    this.adapter = adapter;
    this.alreadyCreatedObjects = {};
    this.objectTypes = {};
  }

  async parse(path, element, options = {}) {
    try {
      if (element === null || element === undefined) {
        this.adapter.log.debug("Cannot extract empty: " + path);
        return;
      }

      if (
        (options.parseBase64 && this.isBase64(element)) ||
        (options.parseBase64byIds && options.parseBase64byIds.includes(path))
      ) {
        try {
          element = Buffer.from(element, "base64").toString("utf8");
          if (this.isJsonString(element)) {
            element = JSONbig.parse(element);
          }
        } catch (error) {
          this.adapter.log.warn(`Cannot parse base64 for ${path}: ${error}`);
        }
      }
      const objectKeys = Object.keys(element);

      if (!options || !options.write) {
        if (!options) {
          options = { write: false };
        } else {
          options["write"] = false;
        }
      }

      if (typeof element === "string" || typeof element === "number") {
        //remove ending . from path
        if (path.endsWith(".")) {
          path = path.slice(0, -1);
        }
        const lastPathElement = path.split(".").pop();

        if (!this.alreadyCreatedObjects[path] || this.objectTypes[path] !== typeof element) {
          let type = element !== null ? typeof element : "mixed";
          if (this.objectTypes[path] && this.objectTypes[path] !== typeof element) {
            type = "mixed";
            this.adapter.log.debug(`Type changed for ${path} from ${this.objectTypes[path]} to ${type}`);
          }
          let states;
          if (options.states && options.states[path]) {
            states = options.states[path];
            if (!states[element]) {
              states[element] = element;
            }
          }
          const common = {
            name: lastPathElement,
            role: this.getRole(element, options.write),
            type: type,
            write: options.write,
            read: true,
            states: states,
          };
          await this.createState(path, common);
        }
        await this.adapter.setStateAsync(path, element, true);

        return;
      }
      if (options.removePasswords && path.toString().toLowerCase().includes("password")) {
        this.adapter.log.debug(`skip password : ${path}`);
        return;
      }
      if (!this.alreadyCreatedObjects[path] || options.deleteBeforeUpdate) {
        if (options.deleteBeforeUpdate) {
          this.adapter.log.debug(`Deleting ${path} before update`);
          for (const key in this.alreadyCreatedObjects) {
            if (key.startsWith(path)) {
              delete this.alreadyCreatedObjects[key];
            }
          }
          await this.adapter.delObjectAsync(path, { recursive: true });
        }
        let name = options.channelName || "";
        if (options.preferedArrayDesc && element[options.preferedArrayDesc]) {
          name = element[options.preferedArrayDesc];
        }
        await this.adapter
          .setObjectNotExistsAsync(path, {
            type: "channel",
            common: {
              name: name,
              write: false,
              read: true,
            },
            native: {},
          })
          .then(() => {
            this.alreadyCreatedObjects[path] = true;
            options.channelName = undefined;
            options.deleteBeforeUpdate = undefined;
          })
          .catch((error) => {
            this.adapter.log.error(error);
          });
      }
      if (Array.isArray(element)) {
        await this.extractArray(element, "", path, options);
        return;
      }

      for (const key of objectKeys) {
        if (key.toLowerCase().includes("password") && options.removePasswords) {
          this.adapter.log.debug(`skip password : ${path}.${key}`);
          return;
        }
        if (typeof element[key] === "function") {
          this.adapter.log.debug("Skip function: " + path + "." + key);
          continue;
        }
        if (element[key] == null) {
          element[key] = "";
        }
        if (this.isJsonString(element[key]) && options.autoCast) {
          element[key] = JSONbig.parse(element[key]);
        }

        if (
          (options.parseBase64 && this.isBase64(element[key])) ||
          (options.parseBase64byIds && options.parseBase64byIds.includes(key))
        ) {
          try {
            element[key] = Buffer.from(element[key], "base64").toString("utf8");
            if (this.isJsonString(element[key])) {
              element[key] = JSONbig.parse(element[key]);
            }
          } catch (error) {
            this.adapter.log.warn(`Cannot parse base64 for ${path + "." + key}: ${error}`);
          }
        }

        if (Array.isArray(element[key])) {
          await this.extractArray(element, key, path, options);
        } else if (element[key] !== null && typeof element[key] === "object") {
          await this.parse(path + "." + key, element[key], options);
        } else {
          //custom decimal trim
          const trimToTwoDecArray = [
            "percentage_charged",
            "battery_power",
            "energy_left",
            "load_power",
            "grid_power",
            "solar_power",
            "battery",
            "solar",
          ];
          if (trimToTwoDecArray.includes(key) || key.indexOf("_imported") !== -1 || key.indexOf("_exported") !== -1) {
            element[key] = parseFloat(parseFloat(element[key]).toFixed(2));
          }
          if (!this.alreadyCreatedObjects[path + "." + key]) {
            await this.adapter
              .setObjectNotExistsAsync(path + "." + key, {
                type: "state",
                common: {
                  name: key,
                  role: this.getRole(element[key], options.write),
                  type: element[key] !== null ? typeof element[key] : "mixed",
                  write: options.write,
                  read: true,
                },
                native: {},
              })
              .then(() => {
                this.alreadyCreatedObjects[path + "." + key] = true;
              })
              .catch((error) => {
                this.adapter.log.error(error);
              });
          }

          this.adapter.setState(path + "." + key, element[key], true);
          //custom mileage conversion
          const pathKey = key.replace(/\./g, "_");
          if (
            (key.endsWith("_range") && !isNaN(element[key]) && element[key] !== true) ||
            key === "odometer" ||
            key === "range" ||
            key === "speed" ||
            !this.alreadyCreatedObjects[path + "." + pathKey] ||
            this.objectTypes[path + "." + pathKey] !== typeof element[key]
          ) {
            if (!this.alreadyCreatedObjects[path + "." + key + "_km"]) {
              await this.adapter
                .setObjectNotExistsAsync(path + "." + key + "_km", {
                  type: "state",
                  common: {
                    name: key,
                    role: this.getRole(element[key], options.write),
                    type: "number",
                    write: options.write,
                    read: true,
                  },
                  native: {},
                })
                .then(() => {
                  this.alreadyCreatedObjects[path + "." + key + "_km"] = true;
                })
                .catch((error) => {
                  this.adapter.log.error(error);
                });
              let objectName = key;
              if (options.descriptions && options.descriptions[key]) {
                objectName = options.descriptions[key];
              }
              let type = element[key] !== null ? typeof element[key] : "mixed";
              if (
                this.objectTypes[path + "." + pathKey] &&
                this.objectTypes[path + "." + pathKey] !== typeof element[key]
              ) {
                type = "mixed";
                this.adapter.log.debug(
                  `Type changed for ${path + "." + pathKey} from ${this.objectTypes[path + "." + pathKey]} to ${type}`,
                );
              }
              let states;
              if (options.states && options.states[key]) {
                states = options.states[key];
                if (!states[element[key]]) {
                  states[element[key]] = element[key];
                }
              }
              this.adapter.setState(path + "." + key + "_km", parseFloat((element[key] * 1.609344).toFixed(2)), true);

              const common = {
                name: objectName,
                role: this.getRole(element[key], options.write),
                type: type,
                write: options.write,
                read: true,
                states: states,
              };

              await this.createState(path + "." + pathKey, common);
            }
            this.adapter.setState(path + "." + key + "_km", parseFloat((element[key] * 1.609344).toFixed(2)), true);
          }
        }
      }
    } catch (error) {
      this.adapter.log.error("Error extract keys: " + path + " " + JSON.stringify(element));
      this.adapter.log.error(error);
    }
  }
  async createState(path, common) {
    await this.adapter
      .extendObjectAsync(path, {
        type: "state",
        common: common,
        native: {},
      })
      .then(() => {
        this.alreadyCreatedObjects[path] = true;
        this.objectTypes[path] = common.type;
      })
      .catch((error) => {
        this.adapter.log.error(error);
      });
  }

  async extractArray(element, key, path, options) {
    try {
      if (key) {
        element = element[key];
      }
      for (let index in element) {
        const arrayElement = element[index];
        if (arrayElement == null) {
          this.adapter.log.debug("Cannot extract empty: " + path + "." + key + "." + index);
          continue;
        }
        // @ts-ignore
        index = parseInt(index) + 1;
        // @ts-ignore
        if (index < 10) {
          index = "0" + index;
        }
        let arrayPath = key + index;
        if (typeof arrayElement === "string" && key !== "") {
          await this.parse(path + "." + key + "." + arrayElement, arrayElement, options);
          continue;
        }
        if (typeof arrayElement[Object.keys(arrayElement)[0]] === "string") {
          arrayPath = arrayElement[Object.keys(arrayElement)[0]];
        }
        for (const keyName of Object.keys(arrayElement)) {
          if (keyName.endsWith("Id") && arrayElement[keyName] !== null) {
            if (arrayElement[keyName] && arrayElement[keyName].replace) {
              arrayPath = arrayElement[keyName].replace(/\./g, "");
            } else {
              arrayPath = arrayElement[keyName];
            }
          }
        }
        for (const keyName in Object.keys(arrayElement)) {
          if (keyName.endsWith("Name")) {
            if (arrayElement[keyName] && arrayElement[keyName].replace) {
              arrayPath = arrayElement[keyName].replace(/\./g, "");
            } else {
              arrayPath = arrayElement[keyName];
            }
          }
        }

        if (arrayElement.id) {
          if (arrayElement.id.replace) {
            arrayPath = arrayElement.id.replace(/\./g, "");
          } else {
            arrayPath = arrayElement.id;
          }
        }
        if (arrayElement.name) {
          arrayPath = arrayElement.name.replace(/\./g, "");
        }
        if (arrayElement.label) {
          arrayPath = arrayElement.label.replace(/\./g, "");
        }
        if (arrayElement.labelText) {
          arrayPath = arrayElement.labelText.replace(/\./g, "");
        }
        if (arrayElement.start_date_time) {
          arrayPath = arrayElement.start_date_time.replace(/\./g, "");
        }

        if (options.preferedArrayName && options.preferedArrayName.indexOf("+") !== -1) {
          const preferedArrayNameArray = options.preferedArrayName.split("+");
          if (arrayElement[preferedArrayNameArray[0]] !== undefined) {
            const element0 = arrayElement[preferedArrayNameArray[0]].toString().replace(/\./g, "").replace(/ /g, "");
            let element1 = "";
            if (preferedArrayNameArray[1].indexOf("/") !== -1) {
              const subArray = preferedArrayNameArray[1].split("/");
              const subElement = arrayElement[subArray[0]];
              if (subElement && subElement[subArray[1]] !== undefined) {
                element1 = subElement[subArray[1]];
              } else if (arrayElement[subArray[1]] !== undefined) {
                element1 = arrayElement[subArray[1]];
              }
            } else {
              element1 = arrayElement[preferedArrayNameArray[1]].toString().replace(/\./g, "").replace(/ /g, "");
            }
            arrayPath = element0 + "-" + element1;
          }
        } else if (options.preferedArrayName && options.preferedArrayName.indexOf("/") !== -1) {
          const preferedArrayNameArray = options.preferedArrayName.split("/");
          const subElement = arrayElement[preferedArrayNameArray[0]];
          if (subElement) {
            arrayPath = subElement[preferedArrayNameArray[1]].toString().replace(/\./g, "").replace(/ /g, "");
          }
        } else if (options.preferedArrayName && arrayElement[options.preferedArrayName]) {
          arrayPath = arrayElement[options.preferedArrayName].toString().replace(/\./g, "");
        }

        if (options.forceIndex) {
          arrayPath = key + index;
        }
        //special case array with 2 string objects
        if (
          !options.forceIndex &&
          Object.keys(arrayElement).length === 2 &&
          typeof Object.keys(arrayElement)[0] === "string" &&
          typeof Object.keys(arrayElement)[1] === "string" &&
          typeof arrayElement[Object.keys(arrayElement)[0]] !== "object" &&
          typeof arrayElement[Object.keys(arrayElement)[1]] !== "object" &&
          arrayElement[Object.keys(arrayElement)[0]] !== "null"
        ) {
          let subKey = arrayElement[Object.keys(arrayElement)[0]];
          let subValue = arrayElement[Object.keys(arrayElement)[1]];

          if (
            (options.parseBase64 && this.isBase64(subValue)) ||
            (options.parseBase64byIds && options.parseBase64byIds.includes(subKey))
          ) {
            try {
              subValue = Buffer.from(subValue, "base64").toString("utf8");
              if (this.isJsonString(subValue)) {
                subValue = JSONbig.parse(subValue);
              }
            } catch (error) {
              this.adapter.log.warn(`Cannot parse base64 value ${subValue} for ${path + "." + subKey}: ${error}`);
            }
          }

          const subName = Object.keys(arrayElement)[0] + " " + Object.keys(arrayElement)[1];
          if (key) {
            subKey = key + "." + subKey;
          }
          if (
            !this.alreadyCreatedObjects[path + "." + subKey] ||
            this.objectTypes[path + "." + subKey] !== typeof subValue
          ) {
            let type = subValue !== null ? typeof subValue : "mixed";
            if (this.objectTypes[path + "." + subKey] && this.objectTypes[path + "." + subKey] !== typeof subValue) {
              this.adapter.log.debug(
                `Type of ${path + "." + subKey} changed from ${
                  this.objectTypes[path + "." + subKey]
                } to ${typeof subValue}!`,
              );
              type = "mixed";
            }
            let states;
            if (options.states && options.states[subKey]) {
              states = options.states[subKey];
              if (!states[subValue]) {
                states[subValue] = subValue;
              }
            }
            const common = {
              name: subName,
              role: this.getRole(subValue, options.write),
              type: type,
              write: options.write,
              read: true,
              states: states,
            };
            await this.createState(path + "." + subKey, common);
          }
          await this.adapter.setStateAsync(path + "." + subKey, subValue, true);
          continue;
        }
        await this.parse(path + "." + arrayPath, arrayElement, options);
      }
    } catch (error) {
      this.adapter.log.error("Cannot extract array " + path);
      this.adapter.log.error(error);
    }
  }
  isBase64(str) {
    if (!str || typeof str !== "string") {
      return false;
    }
    const base64regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))/;
    return base64regex.test(str);
  }

  isJsonString(str) {
    try {
      JSON.parse(str);
    } catch (e) {
      return false;
    }
    return true;
  }
  getRole(element, write) {
    if (typeof element === "boolean" && !write) {
      return "indicator";
    }
    if (typeof element === "boolean" && write) {
      return "switch";
    }
    if (typeof element === "number" && !write) {
      return "value";
    }
    if (typeof element === "number" && write) {
      return "level";
    }
    if (typeof element === "string") {
      return "text";
    }
    return "state";
  }
};

// initialize popup window
const SLPopup = {
  debugSchedule() {
    // Dump current header values to console.
    const inputs = SLPopup.objectifyFormValues();
    const schedule = SLPopup.parseInputs(inputs);
    if (schedule && !schedule.err) {
      hdr = {
        'send-at': SLStatic.parseableDateTimeFormat(schedule.sendAt),
        'recur': SLStatic.unparseRecurSpec(schedule.recur),
        'args': schedule.recur.args,
        'cancel-on-reply': schedule.recur.cancelOnReply
      }
      const debugMsg = Object.keys(hdr).reduce((msg,name) => {
        msg.push(`${name}: ${hdr[name]}`); return msg;
      },[]).join("\n    ");
      SLStatic.debug(`DEBUG [SendLater]: Header values:\n    ${debugMsg}`);
    }
  },

  doSendWithSchedule(schedule) {
    if (schedule && !schedule.err) {
      const message = {
        tabId: SLPopup.tabId,
        action: "doSendLater",
        sendAt: schedule.sendAt,
        recurSpec: SLStatic.unparseRecurSpec(schedule.recur),
        args: schedule.recur.args,
        cancelOnReply: schedule.recur.cancelOnReply
      };
      SLStatic.debug(message);
      browser.runtime.sendMessage(message).catch(SLStatic.error);
      setTimeout((() => window.close()), 150);
    }
  },

  doSendNow() {
    const message = {
      tabId: SLPopup.tabId,
      action: "doSendNow"
    };
    SLStatic.debug(message);
    browser.runtime.sendMessage(message).catch(SLStatic.error);
    setTimeout((() => window.close()), 150);
  },

  domElementsAsArray() {
    return [...document.querySelectorAll("*")];
  },

  objectifyDOMElements() {
    const dom = SLPopup.domElementsAsArray();
    return dom.reduce((obj,item) => {
      obj[item.id] = item;
      return obj;
    }, {});
  },

  objectifyFormValues() {
    const domArray = SLPopup.domElementsAsArray();
    const inputs = domArray.reduce((obj,item) => {
        if (item.tagName === "INPUT" || item.tagName === "SELECT") {
          if (item.type === "checkbox" || item.type === "radio") {
            obj[item.id] = item.checked;
          } else {
            obj[item.id] = item.value;
          }
        }
        return obj;
      }, {});
    inputs.radio = {};
    inputs.groups = {};
    domArray.forEach(el => {
      if (el.type === "radio" && el.name && !inputs.radio[el.name]) {
        inputs.radio[el.name] = [...document.getElementsByName(el.name)].reduce(
          (def,elem) => (elem.checked ? elem.value : def), undefined);
      }
      if (el.type === "checkbox" && el.name && !inputs.groups[el.name]) {
        inputs.groups[el.name] =
          [...document.getElementsByName(el.name)].reduce((obj,elem) => {
            obj.ids.push(elem.id);
            obj.vals.push(elem.checked);
            return obj;
          }, { ids:[], vals:[] });
      }
    });
    return inputs;
  },

  evaluateUfunc(funcName, prev, argStr) {
    let args = null;

    if (argStr) {
      try {
        argStr = SLStatic.unparseArgs(SLStatic.parseArgs(argStr));
        args = SLStatic.parseArgs(argStr);
      } catch (ex) {
        SLStatic.warn(ex);
        return { err: (browser.i18n.getMessage("InvalidArgsTitle") + ": " +
                        browser.i18n.getMessage("InvalidArgsBody")) };
      }
    }

    const body = SLPopup.ufuncs[funcName].body;

    const { sendAt, nextspec, nextargs, error } =
      SLStatic.evaluateUfunc(funcName, body, prev, args);
    SLStatic.debug("User function returned:",
                    {sendAt, nextspec, nextargs, error});

    if (error) {
      throw new Error(error);
    } else {
      let recur = SLStatic.parseRecurSpec(nextspec || "none") || { type: "none" };
      if (recur.type !== "none") {
        recur.args = nextargs || "";
      }
      const schedule = { sendAt, recur };
      SLStatic.debug("Popup.js received ufunc response: ",schedule);
      return schedule;
    }
  },

  parseInputs(inputs) {
    // Construct a recur object { type: "...", multiplier: "...", ... }
    const recur = { type: inputs.radio.recur };

    const sendAtDate = inputs["send-date"];
    const sendAtTime = inputs["send-time"];
    let sendAt = null;
    if ((/\d\d\d\d.\d\d.\d\d/).test(sendAtDate) &&
        (/\d\d.\d\d/).test(sendAtTime)) {
      sendAt = SLStatic.parseDateTime(sendAtDate, sendAtTime);
    }

    if (recur.type === "function") {
      try {
        const funcName = inputs["recurFuncSelect"];
        let argStr = inputs["recur-function-args"];
        const schedule = SLPopup.evaluateUfunc(funcName, sendAt, argStr);
        if (schedule.recur.type !== "none") {
          schedule.recur.cancelOnReply = inputs[`recur-cancelonreply`];
        }
        if (schedule.sendAt.getTime() < (new Date()).getTime()-60000) {
          return { err: browser.i18n.getMessage("errorDateInPast") };
        }
        return schedule;
      } catch (ex) {
        return { err: ex.message };
      }
    }

    if (!sendAt) {
      return { err: browser.i18n.getMessage("entervalid") };
    }

    if (SLStatic.compareDateTimes(sendAt, '<', new Date(), true)) {
      return { err: browser.i18n.getMessage("errorDateInPast") };
    }

    if (recur.type !== "none") {
      recur.cancelOnReply = inputs[`recur-cancelonreply`];

      if (recur.type !== "function") {
        recur.multiplier = inputs[`recur-multiplier`];
      }
    }
    switch (recur.type) {
      case "none":
        break;
      case "minutely":
        break;
      case "daily":
        break;
      case "weekly":
        break;
      case "monthly":
        if (inputs["recur-monthly-byweek"]) {
          recur.monthly_day = {
            day: +inputs["recur-monthly-byweek-day"],
            week: +inputs["recur-monthly-byweek-week"]
          };
        } else {
          recur.monthly = sendAt.getDate();
        }
        break;
      case "yearly":
        recur.yearly = {
          month: sendAt.getMonth(),
          date: sendAt.getDate()
        };
        break;
      default:
        SLStatic.error(`unrecognized recurrence type <${recur.type}>`);
        break;
    }

    if (inputs["sendbetween"]) {
      const start = inputs["sendbetween-start"];
      const end = inputs["sendbetween-end"];
      if (start && end) {
        const between = {
          start: SLStatic.parseDateTime(null,start),
          end: SLStatic.parseDateTime(null,end)
        };
        if (SLStatic.compareTimes(between.start,'>=',between.end)) {
          return { err: (browser.i18n.getMessage("endTimeWarningTitle") + ": " +
                          browser.i18n.getMessage("endTimeWarningBody")) };
        } else {
          recur.between = between;
        }
      }
    }

    if (inputs["sendon"]) {
      const dayLimit = inputs.groups["weekdayChecks"].vals;
      recur.days = [...Array(7)].reduce((obj,item,idx) => {
        if (dayLimit[idx]) {
          obj.push(idx);
        }
        return obj;
      }, []);
      if (recur.days.length === 0) {
        return { err: (browser.i18n.getMessage("missingDaysWarningTitle") + ": " +
                       browser.i18n.getMessage("missingDaysWarningBody")) };
      }
    }

    const schedule = { sendAt, recur };
    return schedule;
  },

  updateRecurrenceText() {
    const dom = SLPopup.objectifyDOMElements();

    const specs = ["minutely","daily","weekly","monthly","yearly","function"];
    const recurrence = specs.find(s => dom[s].checked);
    const specDiv = dom['recurrence-spec'];

    const timeArgs = dom['recur-time-args-div'];
    const funcArgs = dom['recur-function-args-div'];
    const funcHelpToggler = dom['showHideFunctionHelp'];
    const funcHelpDiv = dom['funcHelpDiv'];

    if (recurrence) {
      const sendAt = SLStatic.parseDateTime(dom["send-date"].value,
                                            dom["send-time"].value);

      // Toggle vis of time recurrence options and function recurrence options
      timeArgs.style.display = (recurrence === "function") ? "none" : "block";
      funcArgs.style.display = (recurrence === "function") ? "block" : "none";
      if (recurrence === "function") {
        funcHelpToggler.style.display = "inline-block";
      } else {
        funcHelpDiv.style.display = "none";
        funcHelpToggler.style.display = "none";
      }

      if (recurrence !== "function") {
        // Setup the plural text (e.g. every [] minutes)
        let pluralTxt = browser.i18n.getMessage(`plural_${recurrence}`);
        if (recurrence === "yearly") {
          // ... , on [RECUR DATE]
          const dateTxt = (new Intl.DateTimeFormat('default', {month: "long",
              day: "numeric", hour: "numeric", minute: "numeric"})).format(sendAt);
          pluralTxt += ", " + browser.i18n.getMessage("only_on_days", dateTxt);
        } else if (recurrence === "monthly") {
          // ... , on [RECUR DAY]
          const dayOrd = (new Sugar.Date(sendAt)).format("{do}");
          pluralTxt += ", " + browser.i18n.getMessage("only_on_days", `${dayOrd}`);
        } else if (recurrence === "weekly") {
          // ... , on [RECUR WEEKDAY]
          const dateTxt = SLStatic.getWkdayName(sendAt);
          //localeData.weekdays()[sendAt.getDay()];
          pluralTxt += ", " + browser.i18n.getMessage("only_on_days", dateTxt);
        } else if (recurrence === "daily") {
          // ... , at [RECUR TIME]
          pluralTxt += ` at ${(new Sugar.Date(sendAt)).format("%X")}`; // TODO: translate this.
        }
        dom["recurperiod_plural"].textContent = pluralTxt;
      }

      specDiv.style.display = "block";

      dom['monthly-options-div'].style.display =
          (recurrence === "monthly") ? "" : "none";
      dom['recur-multiply'].style.display =
          (recurrence === "monthly") ? "" : "none";

      dom['section-between'].style.display =
        (recurrence === "minutely" || recurrence === "function") ?
          "" : "none";

      dom['recur-limits'].style.display = "block";
    } else {
      specDiv.style.display = "none";
      dom['recur-limits'].style.display = "none";
    }

    SLStatic.stateSetter(dom['recurFuncSelect'].length > 0)(dom['function-recur-radio']);
    SLStatic.stateSetter((recurrence === "function"))(dom['recurFuncSelect']);
  },

  setScheduleButton(schedule) {
    SLPopup.updateRecurrenceText();

    const sendScheduleButton = document.getElementById("sendScheduleButton");

    if (schedule.err) {
      sendScheduleButton.textContent = schedule.err;
      sendScheduleButton.disabled = true;
      return false;
    }

    browser.storage.local.get({ "preferences": {} }).then(storage => {
      const logConsoleLevel = storage.preferences.logConsoleLevel;
      if (["debug", "trace", "all"].includes(logConsoleLevel)) {
        SLPopup.debugSchedule();
      }
    });

    try {
      const scheduleText = SLStatic.formatScheduleForUI(schedule);
      if (scheduleText) {
        sendScheduleButton.textContent = "";
        scheduleText.split("\n").forEach(segment => {
          const lineNode = document.createElement("DIV");
          lineNode.style.display = "block";
          lineNode.style.margin = "0px";
          lineNode.style.width = "100%";
          lineNode.style.textAlign = "center";
          lineNode.textContent = segment.trim();
          sendScheduleButton.appendChild(lineNode);
        });
        // SLStatic.stateSetter(schedule.recur.type !== "function")(
        //   document.getElementById("sendAtTimeDateDiv"));
        sendScheduleButton.disabled = false;
        return true;
      } else {
        SLStatic.debug('scheduleText',scheduleText);
      }
    } catch (ex) {
      SLStatic.debug(ex);
    }
    sendScheduleButton.textContent = browser.i18n.getMessage("entervalid");
    sendScheduleButton.disabled = true;
    return false;
  },

  loadFunctionHelpText() {
    const funcName = document.getElementById("recurFuncSelect").value;
    if (SLPopup.ufuncs[funcName]) {
      const helpTxt = SLPopup.ufuncs[funcName].help;
      const funcHelpDiv = document.getElementById('funcHelpDiv');
      funcHelpDiv.textContent = helpTxt;
    } else {
      SLStatic.warn(`Cannot set help text. Unrecognized function: ${funcName}`);
    }
  },

  saveDefaults() {
    const defaults = {};
    const dom = SLPopup.objectifyDOMElements();
    Object.keys(dom).forEach(key => {
      const element = dom[key];
      if (element.tagName === "INPUT" || element.tagName === "SELECT") {
        if (element.type === "button" || ["send-date", "send-time"].includes(element.id)) {
          // do nothing
        } else if (element.type === "radio" || element.type === "checkbox") {
          defaults[element.id] = element.checked;
        } else if (element.tagName === "SELECT" ||
                  ["number","text","date","time"].includes(element.type)) {
          defaults[element.id] = element.value;
        } else {
          throw (`Unrecognized element <${element.tagName} type=${element.type}...>`);
        }
      }
    });
    SLStatic.debug("Saving default values",defaults);
    browser.storage.local.set({ defaults }).then(() => {
      SLPopup.showCheckMark(dom["save-defaults"], "green");
    }).catch((err) => {
      SLStatic.error(err);
      SLPopup.showCheckMark(dom["save-defaults"], "red");
    });
  },

  clearDefaults() {
    SLStatic.debug("Clearing default dialog values");
    const clrDefaultsElement = document.getElementById("clear-defaults");
    browser.storage.local.set({ defaults: {} }).then(() => {
      SLPopup.showCheckMark(clrDefaultsElement, "green");
    }).catch((err) => {
      SLStatic.error(err);
      SLPopup.showCheckMark(clrDefaultsElement, "red");
    });
  },

  async applyDefaults() {
    const { defaults } = await browser.storage.local.get({ defaults: {} });
    const dom = SLPopup.objectifyDOMElements();

    const recurFuncSelect = dom['recurFuncSelect'];
    [...Object.keys(SLPopup.ufuncs)].sort().forEach(funcName => {
      if (funcName !== "ReadMeFirst" && funcName !== "newFunctionName") {
        const newOpt = document.createElement('option');
        newOpt.id = `ufunc-${funcName}`;
        newOpt.value = funcName;
        newOpt.textContent = funcName;
        recurFuncSelect.appendChild(newOpt);
      }
    });

    if (defaults && defaults.daily !== undefined) {
      SLStatic.debug("Applying default values",defaults);
      Object.keys(dom).forEach(key => {
        const element = dom[key];
        if (element.tagName === "INPUT" || element.tagName === "SELECT") {
          const defaultValue = defaults[element.id];
          if (defaultValue === undefined || element.type === "button" ||
              ["send-date","send-time"].includes(element.id)) {
            return;
          } else if (element.type === "radio" || element.type === "checkbox") {
            element.checked = (defaults[element.id]);
          } else if (element.tagName === "SELECT" ||
                    ["number","text","date","time"].includes(element.type)) {
            element.value = (defaults[element.id]);
          } else {
            throw (`Unrecognized element <${element.tagName} type=${element.type}...>`);
          }
        }
      });
    }

    const soon = new Sugar.Date(Date.now()+ (5*60*1000)); // 5 minutes from now default
    dom["send-date"].value = soon.format('%Y-%m-%d');
    dom["send-time"].value = soon.format('%H:%M');
    dom["send-datetime"].value = soon.long();

    SLStatic.stateSetter(dom["sendon"].checked)(dom["onlyOnDiv"]);
    SLStatic.stateSetter(dom["sendbetween"].checked)(dom["betweenDiv"]);

    SLPopup.loadFunctionHelpText();

    // Trigger some fake events to activate listeners
    dom['once'].dispatchEvent(new Event('change'));
  },

  showCheckMark(element, color) {
    // Appends a checkmark as element's last sibling. Disappears after a
    // timeout (1.5 sec). If is already displayed, then restart timeout.
    const checkmark = document.createElement("span");
    checkmark.textContent = String.fromCharCode(0x2714);
    checkmark.style.color = color;
    checkmark.className = "success_icon";

    const p = element.parentNode;
    if (p.lastChild.className === 'success_icon') {
      p.replaceChild(checkmark, p.lastChild);
    } else {
      p.appendChild(checkmark);
    }
    setTimeout(() => checkmark.remove(), 1500);
  },

  attachListeners() {
    const dom = SLPopup.objectifyDOMElements();

    const dateTimeInputListener = ((evt) => {
      if (evt.target.id === "send-date" || evt.target.id === "send-time") {
        if (dom["send-date"].value && dom["send-time"].value) {
          const sendAt = SLStatic.parseDateTime(dom["send-date"].value, dom["send-time"].value);
          dom["send-datetime"].value = (new Sugar.Date(sendAt)).long();
        }
      } else if (evt.target.id === "send-datetime") {
        const localeCode = browser.i18n.getUILanguage();
        const sendAtDate = Sugar.Date.create(dom["send-datetime"].value,
                                             {locale: localeCode,
                                              future: true});
        try {
          const sendAt = new Sugar.Date(sendAtDate);
          dom["send-date"].value = sendAt.format('%Y-%m-%d');
          dom["send-time"].value = sendAt.format('%H:%M');
        } catch (ex) {
          dom["send-date"].value = '';
          dom["send-time"].value = '';
        }
      }
    });
    dom["send-date"].addEventListener("change", dateTimeInputListener);
    dom["send-time"].addEventListener("change", dateTimeInputListener);
    dom["send-datetime"].addEventListener("change", dateTimeInputListener);

    SLStatic.stateSetter(dom["sendon"].checked)(dom["onlyOnDiv"]);
    SLStatic.stateSetter(dom["sendbetween"].checked)(dom["betweenDiv"]);
    dom["sendon"].addEventListener("change", evt =>
      SLStatic.stateSetter(evt.target.checked)(dom["onlyOnDiv"]));
    dom["sendbetween"].addEventListener("change", evt =>
      SLStatic.stateSetter(evt.target.checked)(dom["betweenDiv"])
    );
    Object.keys(dom).forEach(key => {
      const element = dom[key];
      if ((element.tagName === "INPUT" || element.tagName === "SELECT") &&
            (element.type !== "button")) {
        element.addEventListener("change", () => {
          const inputs = SLPopup.objectifyFormValues();
          const schedule = SLPopup.parseInputs(inputs);
          SLStatic.stateSetter(schedule.recur && schedule.recur.type !== "none")(
            dom['cancel-on-reply-div']);
          SLPopup.setScheduleButton(schedule);
        });
      }
    });
    [...document.getElementsByName("recur")].forEach(element =>
      element.addEventListener("change", SLPopup.updateRecurrenceText));

    dom['recurFuncSelect'].addEventListener("change", SLPopup.loadFunctionHelpText);

    dom['showHideFunctionHelp'].addEventListener("click", () => {
        const specs = ["minutely","daily","weekly","monthly","yearly","function"];
        const recurrence = specs.find(s => dom[s].checked);
        if (recurrence === "function") {
          const currentState = (dom['funcHelpDiv'].style.display === "block");
          dom['funcHelpDiv'].style.display = currentState ? "none" : "block";
        }
      });

    dom["save-defaults"].addEventListener("click", SLPopup.saveDefaults);
    dom["clear-defaults"].addEventListener("click", SLPopup.clearDefaults);

    dom["sendScheduleButton"].addEventListener("click", () => {
      const inputs = SLPopup.objectifyFormValues();
      const schedule = SLPopup.parseInputs(inputs);
      SLPopup.doSendWithSchedule(schedule);
    });

    browser.storage.local.get({ preferences: {} }).then(({ preferences }) => {
      for (let i=1;i<4;i++) {
        const funcName = preferences[`quickOptions${i}funcselect`];
        const funcArgs = preferences[`quickOptions${i}Args`];

        const quickBtn = dom[`quick-opt-${i}`];
        quickBtn.value = preferences[`quickOptions${i}Label`];
        quickBtn.addEventListener("click", () => {
          const schedule = SLPopup.evaluateUfunc(funcName, null, funcArgs);
          SLPopup.doSendWithSchedule(schedule);
        });
      }
    });

    dom["sendNow"].addEventListener("click", SLPopup.doSendNow);

    setTimeout(() => document.getElementById("send-datetime").select(), 50);
  },

  async init() {
    SLPopup.tabId = await browser.tabs.query({
      active:true, currentWindow:true
    }).then(tabs => tabs[0].id);

    const { ufuncs } = await browser.storage.local.get({ ufuncs: {} });
    SLPopup.ufuncs = ufuncs;

    SLPopup.attachListeners();

    SLPopup.applyDefaults();

    SLStatic.debug("Initialized popup window");
  }
};

// For testing purposes, because the browser mock script needs to
// asynchronously load translations.
function waitAndInit() {
  if (browser.i18n.getMessage("recurMonthlyLabel") === "recurMonthlyLabel") {
    setTimeout(waitAndInit, 10);
  } else {
    SLPopup.init();
  }
}

window.addEventListener("load", waitAndInit, false);

window.addEventListener("unload", (evt) => {
  browser.runtime.sendMessage({
    tabId: SLPopup.tabId,
    action: "closingComposePopup"
  }).catch(SLStatic.error);
});

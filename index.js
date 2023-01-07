const midi = require("midi");
const commander = require("commander");
const VigemClient = require("vigemclient");

let mInput; // global midi instance

const program = new commander.Command();
program.option("-c, --controller", "Specify which MIDI controller to use", "0")

program
	.command("debug")
	.action(debug);
program
	.command("calibrate")
	.action(calibrate);
program
	.command("start")
	.action(start);

program.parse(process.argv);

const statusMap = {
	0b1000: "NoteOff",
	0b1001: "NoteOn",
	0b1010: "PolyKeyPressure",
	0b1011: "ControllerChange",
	0b1100: "ProgramChange",
	0b1101: "ChannelPressure",
	0b1110: "PitchBend",
}

function parseMidiMessage(message) {
	const [ statusByte, data1, data2 ] = message;

	const status = statusMap[(statusByte & 0xF0) >> 4];
	const channel = statusByte & 0x0F;

	switch(status) {
		case "NoteOff":
		case "NoteOn":
			return {
				status,
				channel,
				key: data1 & 0x7F,
				velocity: data2 & 0x7F,
			};
		case "PolyKeyPressure":
			return {
				status,
				channel,
				key: data1 & 0x7F,
				pressure: data2 & 0x7F,
			}
		case "ControllerChange":
			return {
				status,
				channel,
				controller: data1 & 0x7F,
				value: data2 & 0x7F,
			}
		case "ProgramChange":
			return {
				status,
				channel,
				preset: data1 & 0x7F,
			}
		case "ChannelPressure":
			return {
				status,
				channel,
				pressure: data1 & 0x7F,
			}
		case "PitchBend":
			return {
				status,
				channel,
				pitch: ((data2 & 0x7F) << 7) + (data1 & 0x7F),
			}
		default:
			return {
				statusByte, data1, data2
			}
	}
}

function openMidiController() {
	mInput= new midi.Input();
	console.log(`Found ${mInput.getPortCount()} midi controller(s)`);
	const controller = Number(program.opts().controller);

	console.log(`Using MIDI controller ${mInput.getPortName(controller)}`);
	mInput.openPort(controller);
}

function debug() {
	openMidiController();

	mInput.on("message", (delta, message) => {
		console.log(parseMidiMessage(message));
	});
}

function calibrate() {

}

const valueCache = {};

const controlMap = {
	ControllerChange: {
		1: {
			33: (ctrl, value) => {
				ctrl.axis.leftX.setValue(ctrl.axis.leftX.value + ((value > 64) ? 0.01 : -0.01));
			},
			34: (ctrl, value) => {
				ctrl.axis.leftX.setValue(ctrl.axis.leftX.value + ((value > 64) ? 0.01 : -0.01));
			},
		},
		0: {
			0: (ctrl, value) => valueCache["0,0"] = value,
			32: (ctrl, value) => {
				const final = ((value + (valueCache["0,0"] << 7)) - 8192) / 8192;

				if (final >= 0) {
					ctrl.axis.rightTrigger.setValue(final);
					ctrl.axis.leftTrigger.setValue(0);
				} else {
					ctrl.axis.rightTrigger.setValue(0);
					ctrl.axis.leftTrigger.setValue(-final);
				}
			},
			19: (ctrl, value) => valueCache["0,19"] = value,
			51: (ctrl, value) => {
				const final = ((value + (valueCache["0,19"] << 7)) - 8192) / 8192;
				ctrl.axis.leftY.setValue(final);
			},
		},
		6: {
			31: (ctrl, value) => valueCache["6,31"] = value,
			63: (ctrl, value) => {
				const final = ((value + (valueCache["6,31"] << 7)) - 8192) / 8192;
				ctrl.axis.leftX.setValue(final);
			},
			24: (ctrl, value) => valueCache["6,24"] = value,
			56: (ctrl, value) => {
				const final = ((value + (valueCache["6,24"] << 7)) - 8192) / 8192;
				const angle = final * Math.PI/2;
				if (final == 0) {
					ctrl.axis.rightX.setValue(0);
					ctrl.axis.rightY.setValue(0);
				} else {
					ctrl.axis.rightX.setValue(Math.sin(angle));
					ctrl.axis.rightY.setValue(Math.cos(angle));
				}
			},
		}
	},
	NoteOn: {
		1: {
			12: (ctrl, value) => ctrl.button.A.setValue(value > 64),
			11: (ctrl, value) => ctrl.button.B.setValue(value > 64),
			// 27: (ctrl, value) => ctrl.button.RIGHT_SHOULDER.setValue(value > 64),
			// 109: (ctrl, value) => ctrl.button.LEFT_SHOULDER.setValue(value > 64),
			63: (ctrl, value) => ctrl.button.RIGHT_SHOULDER.setValue(value > 64),
			84: (ctrl, value) => ctrl.button.START.setValue(value > 64),
		},
		0: {
			12: (ctrl, value) => ctrl.button.X.setValue(value > 64),
			11: (ctrl, value) => ctrl.button.Y.setValue(value > 64),
			84: (ctrl, value) => ctrl.button.BACK.setValue(value > 64),
			63: (ctrl, value) => ctrl.button.LEFT_SHOULDER.setValue(value > 64),
		},
		4: {
			74: (ctrl, value) => ctrl.button.LEFT_SHOULDER.setValue(value > 64),
			75: (ctrl, value) => ctrl.button.RIGHT_SHOULDER.setValue(value > 64),
		},
	},
};

function start() {
	openMidiController();
	const client = new VigemClient();
	client.connect();

	const controller = client.createX360Controller();
	controller.connect();

	mInput.on("message", (delta, message) => {
		const m = parseMidiMessage(message);

		if (m.status in controlMap && m.channel in controlMap[m.status] && m.controller in controlMap[m.status][m.channel]) {
			controlMap[m.status][m.channel][m.controller](controller, m.value);
			// console.log(m);
		}
		if (m.status in controlMap && m.channel in controlMap[m.status] && m.key in controlMap[m.status][m.channel]) {
			controlMap[m.status][m.channel][m.key](controller, m.velocity);
			// console.log(m);
		}
	});
}
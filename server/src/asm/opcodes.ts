
export const Opcodes6502 = {
	"ADC": {
		"IMM" : 0x69,
		"ZP"  : 0x65,
		"ZPX" : 0x75,
		"ABS" : 0x6D,
		"ABSX": 0x7D,
		"ABSY": 0x79,
		"INDX": 0x61,
		"INDY": 0x71
	},
	"AND": {
		"IMM" : 0x29,
		"ZP"  : 0x25,
		"ZPX" : 0x35,
		"ABS" : 0x2D,
		"ABSX": 0x3D,
		"ABSY": 0x39,
		"INDX": 0x21,
		"INDY": 0x31
	},
	"ASL": {
		"NONE": 0x0A,
		"A"   : 0x0A,
		"ZP"  : 0x06,
		"ZPX" : 0x16,
		"ABS" : 0x0E,
		"ABSX": 0x1E
	},
	"BCC": {
		"BRAN": 0x90
	},
	"BCS": {
		"BRAN": 0xB0
	},
	"BEQ": {
		"BRAN": 0xF0
	},
	"BGE": {				// alias of BCS
		"BRAN": 0xB0
	},
	"BIT": {
		"ZP"  : 0x24,
		"ABS" : 0x2C
	},
	"BLT": {				// alias of BCC
		"BRAN": 0x90
	},
	"BMI": {
		"BRAN": 0x30
	},
	"BNE": {
		"BRAN": 0xD0
	},
	"BPL": {
		"BRAN": 0x10
	},
	// "BRA": {
	// 	OPC(BRAN: 0x80)		// 65C02
	// },
	"BRK": {
		"NONE": 0x00
	},
	"BVC": {
		"BRAN": 0x50
	},
	"BVS": {
		"BRAN": 0x70
	},
	"CLC": {
		"NONE": 0x18
	},
	"CLD": {
		"NONE": 0xD8
	},
	"CLI": {
		"NONE": 0x58
	},
	"CLV": {
		"NONE": 0xB8
	},
	"CMP": {
		"IMM" : 0xC9,
		"ZP"  : 0xC5,
		"ZPX" : 0xD5,
		"ABS" : 0xCD,
		"ABSX": 0xDD,
		"ABSY": 0xD9,
		"INDX": 0xC1,
		"INDY": 0xD1
	},
	"CPX": {
		"IMM" : 0xE0,
		"ZP"  : 0xE4,
		"ABS" : 0xEC
	},
	"CPY": {
		"IMM" : 0xC0,
		"ZP"  : 0xC4,
		"ABS" : 0xCC
	},
	"DEC": {
		// OPC(NONE: 0x3A)		// 65C02
		// OPC(A   : 0x3A)		// 65C02
		"ZP"  : 0xC6,
		"ZPX" : 0xD6,
		"ABS" : 0xCE,
		"ABSX": 0xDE
	},
	"DEX": {
		"NONE": 0xCA
	},
	"DEY": {
		"NONE": 0x88
	},
	"EOR": {
		"IMM" : 0x49,
		"ZP"  : 0x45,
		"ZPX" : 0x55,
		"ABS" : 0x4D,
		"ABSX": 0x5D,
		"ABSY": 0x59,
		"INDX": 0x41,
		"INDY": 0x51
	},
	"INC": {
		// OPC(NONE: 0x1A)		// 65C02
		// OPC(A   : 0x1A)		// 65C02
		"ZP"  : 0xE6,
		"ZPX" : 0xF6,
		"ABS" : 0xEE,
		"ABSX": 0xFE
	},
	"INX": {
		"NONE": 0xE8
	},
	"INY": {
		"NONE": 0xC8
	},
	"JMP": {
		"ABS" : 0x4C,
		"IND" : 0x6C
	},
	"JSR": {
		"ABS" : 0x20
	},
	"LDA": {
		"IMM" : 0xA9,
		"ZP"  : 0xA5,
		"ZPX" : 0xB5,
		"ABS" : 0xAD,
		"ABSX": 0xBD,
		"ABSY": 0xB9,
		"INDX": 0xA1,
		"INDY": 0xB1
	},
	"LDX": {
		"IMM" : 0xA2,
		"ZP"  : 0xA6,
		"ZPY" : 0xB6,
		"ABS" : 0xAE,
		"ABSY": 0xBE
	},
	"LDY": {
		"IMM" : 0xA0,
		"ZP"  : 0xA4,
		"ZPX" : 0xB4,
		"ABS" : 0xAC,
		"ABSX": 0xBC
	},
	"LSR": {
		"NONE": 0x4A,
		"A"   : 0x4A,
		"ZP"  : 0x46,
		"ZPX" : 0x56,
		"ABS" : 0x4E,
		"ABSX": 0x5E
	},
	"NOP": {
		"NONE": 0xEA
	},
	"ORA": {
		"IMM" : 0x09,
		"ZP"  : 0x05,
		"ZPX" : 0x15,
		"ABS" : 0x0D,
		"ABSX": 0x1D,
		"ABSY": 0x19,
		"INDX": 0x01,
		"INDY": 0x11
	},
	"PHA": {
		"NONE": 0x48
	},
	"PHP": {
		"NONE": 0x08
	},
	// "PHX": {
	// 	OPC(NONE: 0xDA)		// 65C02
	// },
	// "PHY": {
	// 	OPC(NONE: 0x5A)		// 65C02
	// },
	"PLA": {
		"NONE": 0x68
	},
	"PLP": {
		"NONE": 0x28
	},
	// "PLX": {
	// 	OPC(NONE: 0xFA)		// 65C02
	// },
	// "PLY": {
	// 	OPC(NONE: 0x7A)		// 65C02
	// },
	// "REP": {
	// 	OPG(IMM,  0xC2)		// 65816
	// },
	"ROL": {
		"NONE": 0x2A,
		"A"   : 0x2A,
		"ZP"  : 0x26,
		"ZPX" : 0x36,
		"ABS" : 0x2E,
		"ABSX": 0x3E
	},
	"ROR": {
		"NONE": 0x6A,
		"A"   : 0x6A,
		"ZP"  : 0x66,
		"ZPX" : 0x76,
		"ABS" : 0x6E,
		"ABSX": 0x7E
	},
	"RTI": {
		"NONE": 0x40
	},
	"RTS": {
		"NONE": 0x60
	},
	"SBC": {
		"IMM" : 0xE9,
		"ZP"  : 0xE5,
		"ZPX" : 0xF5,
		"ABS" : 0xED,
		"ABSX": 0xFD,
		"ABSY": 0xF9,
		"INDX": 0xE1,
		"INDY": 0xF1
	},
	"SEC": {
		"NONE": 0x38
	},
	"SED": {
		"NONE": 0xF8
	},
	"SEI": {
		"NONE": 0x78
	},
	// "SEP": {
	// 	OPG(IMM,  0xE2)		// 65816
	// },
	"STA": {
		"ZP"  : 0x85,
		"ZPX" : 0x95,
		"ABS" : 0x8D,
		"ABSX": 0x9D,
		"ABSY": 0x99,
		"INDX": 0x81,
		"INDY": 0x91
	},
	"STX": {
		"ZP"  : 0x86,
		"ZPY" : 0x96,
		"ABS" : 0x8E
	},
	"STY": {
		"ZP"  : 0x84,
		"ZPX" : 0x94,
		"ABS" : 0x8C
	},
	// "STZ": {
	// 	OPC(ZP  : 0x64)		// 65C02
	// 	OPC(ZPX : 0x74)		// 65C02
	// 	OPC(ABS : 0x9C)		// 65C02
	// 	OPC(ABSX: 0x9E)		// 65C02
	// },
	"TAX": {
		"NONE": 0xAA
	},
	"TAY": {
		"NONE": 0xA8
	},
	// "TRB": {
	// 	OPC(ZP  : 0x14)		// 65C02
	// 	OPC(ABS : 0x1C)		// 65C02
	// },
	// "TSB": {
	// 	OPC(ZP  : 0x04)		// 65C02
	// 	OPC(ABS : 0x0C)		// 65C02
	// },
	"TSX": {
		"NONE": 0xBA
	},
	"TXA": {
		"NONE": 0x8A
	},
	"TXS": {
		"NONE": 0x9A
	},
	"TYA": {
		"NONE": 0x98
	},
	// "XCE": {
	// 	OPG(NONE: 0xFB)		// 65816
	// }
}


export const Opcodes6502 = {
	"adc": {
		"IMM" : 0x69,
		"ZP"  : 0x65,
		"ZPX" : 0x75,
		"ABS" : 0x6D,
		"ABSX": 0x7D,
		"ABSY": 0x79,
		"INDX": 0x61,
		"INDY": 0x71
	},
	"and": {
		"IMM" : 0x29,
		"ZP"  : 0x25,
		"ZPX" : 0x35,
		"ABS" : 0x2D,
		"ABSX": 0x3D,
		"ABSY": 0x39,
		"INDX": 0x21,
		"INDY": 0x31
	},
	"asl": {
		"NONE": 0x0A,
		"A"   : 0x0A,
		"ZP"  : 0x06,
		"ZPX" : 0x16,
		"ABS" : 0x0E,
		"ABSX": 0x1E
	},
	"bcc": {
		"REL" : 0x90
	},
	"bcs": {
		"REL" : 0xB0
	},
	"beq": {
		"REL" : 0xF0
	},
	"bge": {				// alias of BCS
		"REL" : 0xB0
	},
	"bit": {
		"ZP"  : 0x24,
		"ABS" : 0x2C
	},
	"blt": {				// alias of BCC
		"REL" : 0x90
	},
	"bmi": {
		"REL" : 0x30
	},
	"bne": {
		"REL" : 0xD0
	},
	"bpl": {
		"REL" : 0x10
	},
	"brk": {
		"NONE": 0x00,
		"IMM":  0x00	// allow optional immediate argument
	},
	"bvc": {
		"REL" : 0x50
	},
	"bvs": {
		"REL" : 0x70
	},
	"clc": {
		"NONE": 0x18
	},
	"cld": {
		"NONE": 0xD8
	},
	"cli": {
		"NONE": 0x58
	},
	"clv": {
		"NONE": 0xB8
	},
	"cmp": {
		"IMM" : 0xC9,
		"ZP"  : 0xC5,
		"ZPX" : 0xD5,
		"ABS" : 0xCD,
		"ABSX": 0xDD,
		"ABSY": 0xD9,
		"INDX": 0xC1,
		"INDY": 0xD1
	},
	"cpx": {
		"IMM" : 0xE0,
		"ZP"  : 0xE4,
		"ABS" : 0xEC
	},
	"cpy": {
		"IMM" : 0xC0,
		"ZP"  : 0xC4,
		"ABS" : 0xCC
	},
	"dec": {
		"NONE": 0x3A,		// 65C02
		"A"   : 0x3A,		// 65C02
		"ZP"  : 0xC6,
		"ZPX" : 0xD6,
		"ABS" : 0xCE,
		"ABSX": 0xDE
	},
	"dex": {
		"NONE": 0xCA
	},
	"dey": {
		"NONE": 0x88
	},
	"eor": {
		"IMM" : 0x49,
		"ZP"  : 0x45,
		"ZPX" : 0x55,
		"ABS" : 0x4D,
		"ABSX": 0x5D,
		"ABSY": 0x59,
		"INDX": 0x41,
		"INDY": 0x51
	},
	"inc": {
		"NONE": 0x1A,		// 65C02
		"A"   : 0x1A,		// 65C02
		"ZP"  : 0xE6,
		"ZPX" : 0xF6,
		"ABS" : 0xEE,
		"ABSX": 0xFE
	},
	"inx": {
		"NONE": 0xE8
	},
	"iny": {
		"NONE": 0xC8
	},
	"jmp": {
		"ABS" : 0x4C,
		"IND" : 0x6C
	},
	"jsr": {
		"ABS" : 0x20
	},
	"lda": {
		"IMM" : 0xA9,
		"ZP"  : 0xA5,
		"ZPX" : 0xB5,
		"ABS" : 0xAD,
		"ABSX": 0xBD,
		"ABSY": 0xB9,
		"INDX": 0xA1,
		"INDY": 0xB1
	},
	"ldx": {
		"IMM" : 0xA2,
		"ZP"  : 0xA6,
		"ZPY" : 0xB6,
		"ABS" : 0xAE,
		"ABSY": 0xBE
	},
	"ldy": {
		"IMM" : 0xA0,
		"ZP"  : 0xA4,
		"ZPX" : 0xB4,
		"ABS" : 0xAC,
		"ABSX": 0xBC
	},
	"lsr": {
		"NONE": 0x4A,
		"A"   : 0x4A,
		"ZP"  : 0x46,
		"ZPX" : 0x56,
		"ABS" : 0x4E,
		"ABSX": 0x5E
	},
	"nop": {
		"NONE": 0xEA
	},
	"ora": {
		"IMM" : 0x09,
		"ZP"  : 0x05,
		"ZPX" : 0x15,
		"ABS" : 0x0D,
		"ABSX": 0x1D,
		"ABSY": 0x19,
		"INDX": 0x01,
		"INDY": 0x11
	},
	"pha": {
		"NONE": 0x48
	},
	"php": {
		"NONE": 0x08
	},
	"pla": {
		"NONE": 0x68
	},
	"plp": {
		"NONE": 0x28
	},
	"rol": {
		"NONE": 0x2A,
		"A"   : 0x2A,
		"ZP"  : 0x26,
		"ZPX" : 0x36,
		"ABS" : 0x2E,
		"ABSX": 0x3E
	},
	"ror": {
		"NONE": 0x6A,
		"A"   : 0x6A,
		"ZP"  : 0x66,
		"ZPX" : 0x76,
		"ABS" : 0x6E,
		"ABSX": 0x7E
	},
	"rti": {
		"NONE": 0x40
	},
	"rts": {
		"NONE": 0x60
	},
	"sbc": {
		"IMM" : 0xE9,
		"ZP"  : 0xE5,
		"ZPX" : 0xF5,
		"ABS" : 0xED,
		"ABSX": 0xFD,
		"ABSY": 0xF9,
		"INDX": 0xE1,
		"INDY": 0xF1
	},
	"sec": {
		"NONE": 0x38
	},
	"sed": {
		"NONE": 0xF8
	},
	"sei": {
		"NONE": 0x78
	},
	"sta": {
		"ZP"  : 0x85,
		"ZPX" : 0x95,
		"ABS" : 0x8D,
		"ABSX": 0x9D,
		"ABSY": 0x99,
		"INDX": 0x81,
		"INDY": 0x91
	},
	"stx": {
		"ZP"  : 0x86,
		"ZPY" : 0x96,
		"ABS" : 0x8E
	},
	"sty": {
		"ZP"  : 0x84,
		"ZPX" : 0x94,
		"ABS" : 0x8C
	},
	"tax": {
		"NONE": 0xAA
	},
	"tay": {
		"NONE": 0xA8
	},
	"tsx": {
		"NONE": 0xBA
	},
	"txa": {
		"NONE": 0x8A
	},
	"txs": {
		"NONE": 0x9A
	},
	"tya": {
		"NONE": 0x98
	}
}

export const Opcodes65C02 = {
	"bra": {
		"REL" : 0x80
	},
	"phx": {
		"NONE": 0xDA
	},
	"phy": {
		"NONE": 0x5A
	},
	"plx": {
		"NONE": 0xFA
	},
	"ply": {
		"NONE": 0x7A
	},
	"stz": {
		"ZP"  : 0x64,
		"ZPX" : 0x74,
		"ABS" : 0x9C,
		"ABSX": 0x9E
	},
	"trb": {
		"ZP"  : 0x14,
		"ABS" : 0x1C
	},
	"tsb": {
		"ZP"  : 0x04,
		"ABS" : 0x0C
	}
}

export const Opcodes65816 = {
	"rep": {
		"IMM":  0xC2
	},
	"sep": {
		"IMM":  0xE2
	},
	"xce": {
		"NONE": 0xFB
	}
}

export const Opcodes65EL02 = {
	"nxt": {
		"NONE": 0x02
	},
	"ent": {
		"NONE": 0x22
	},
	"nxa": {
		"NONE": 0x42
	},
	"rer": {
		"REL": 0x82
	},
	"rea": {
		"ABS": 0x44
	},
	"rei": {
		"ZP":  0x54
	},
	"rhi": {
		"NONE": 0x0B
	},
	"rhx": {
		"NONE": 0x1B
	},
	"rli": {
		"NONE": 0x2B
	},
	"rlx": {
		"NONE": 0x3B
	},
	"rha": {
		"NONE": 0x4B
	},
	"rhy": {
		"NONE": 0x5B
	},
	"rla": {
		"NONE": 0x6B
	},
	"rly": {
		"NONE": 0x7B
	},
	"txr": {
		"NONE": 0x8B
	},
	"trx": {
		"NONE": 0xAB
	},
	"txi": {
		"NONE": 0x5C
	},
	"tix": {
		"NONE": 0xDC
	},
	"mul": {
		"ZP": 0x0F,
		"ZPX": 0x1F,
		"ABS": 0x2F,
		"ABSX": 0x3F,
	},
	"div": {
		"ZP": 0x4F,
		"ZPX": 0x5F,
		"ABS": 0x6F,
		"ABSX": 0x7F,
	},
	"zea": {
		"NONE": 0x8F
	},
	"sea": {
		"NONE": 0x9F
	},
	"tda": {
		"NONE": 0xAF
	},
	"tad": {
		"NONE": 0xBF
	},
	"pld": {
		"NONE": 0xCF
	},
	"phd": {
		"NONE": 0xDF
	},
	"mmu": {
		"IMM": 0xEF
	}
}


export const OpcodeSets = [
	Opcodes6502,
	Opcodes65C02,
	Opcodes65816,
	Opcodes65EL02
]

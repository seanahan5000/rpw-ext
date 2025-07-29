
//------------------------------------------------------------------------------

export enum OpMode {
  NONE,     //
  A,        // a
  IMM,      // #$FF
  ZP,       // $FF
  ZPX,      // $FF,X
  ZPY,      // $FF,Y
  ABS,      // $FFFF
  ABSX,     // $FFFF,X
  ABSY,     // $FFFF,Y
  IND,      // ($FFFF)
  INDX,     // ($FF,X)
  INDY,     // ($FF),Y
  REL,      // *+-$FF

  // 65C02-only
  INZ,      // ($FF)
  AXI,      // ($FFFF,X)
  ZP_REL,   // $FF,*+-$FF

  // 65816-only
  LIN,      // [$FF]
  LIY,      // [$FF],Y
  ALI,      // [$FFFF]
  STS,      // stack,S
  SIY,      // (stack,S),Y
  SD,       // #$FF,#$FF
  LREL,     // *+-$FFFF
  LABS,     // $FFFFFF
  LABX,     // $FFFFFF,X

  // 65EL02-only
  STR,      // stack,R
  RIY,      // (stack,R),Y

  ILLEGAL,
}

// TODO: use these somewhere?
// export enum OpCpu {
//   M6502  = 0,
//   M65C02 = 1,
//   M65816 = 2
//   // TODO: M65EL02
//   // TODO: INVALID?
// }

//------------------------------------------------------------------------------

export type OpcodeDef = {
	val: number		// opcode byte value
	name: string	// opcode name
	mode: OpMode	// addressing mode
	bc: number		// byte count
	sf: string		// status flags
	cy: string		// cycles
	fc?: boolean	// flow control
}

export type OpcodeType = Map<OpMode, OpcodeDef> // mode
type OpcodeByName = Map<string, OpcodeType>     // name

export class Isa {
  public opcodeByName: OpcodeByName = new Map<string, OpcodeType>()
  public opcodes: OpcodeDef[] = new Array(256)

  constructor() {
  }

  public getDescByName(name: string): string {
    return ""
  }

  public findByName(name: string): OpcodeType | undefined {
    return this.opcodeByName.get(name)
  }

  public findByNameMode(name: string, opMode: OpMode): OpcodeDef | undefined {
    return this.opcodeByName.get(name)?.get(opMode)
  }

  protected BuildOpcodes(ops: OpcodeDef[], addIllegals = false) {
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i]
      const opName = op.name
      let type = this.opcodeByName.get(opName)
      if (type === undefined) {
        type = new Map<OpMode, OpcodeDef>()
        this.opcodeByName.set(opName, type)
      }
      type.set(op.mode, op)
      this.opcodes[op.val] = op
    }
    if (addIllegals) {
      for (let i = 0; i < this.opcodes.length; i += 1) {
        if (this.opcodes[i] === undefined) {
          this.opcodes[i] = {
            val: i, name: "???", mode: OpMode.ILLEGAL, bc: 1, sf: "", cy: "2"
          }
        }
      }
    }
  }
}

abstract class IsaSet {
  public abstract getIsa(name: string): Isa
}

//------------------------------------------------------------------------------

export class Isa6502 extends Isa {
  constructor() {
    super()
    this.BuildOpcodes(Isa6502.opDefs6502, true)
  }

  public getDescByName(name: string): string {
    return Isa6502.opDescs6502.get(name) ?? ""
  }

  public isIllegal(opByte: number): boolean {
    return this.opcodes[opByte].mode == OpMode.ILLEGAL
  }

  public isFlowControl(opByte: number): boolean {
    return this.opcodes[opByte].fc ?? false
  }

  public isStepOver(opByte: number): boolean {
    return this.opcodes[opByte].name == "jsr"
  }

  // used for StepOut
  public isReturn(opByte: number): boolean {
    return opByte == 0x60 // rts
      || opByte == 0x40   // rti
      // TODO: put in subclass ISA
      || opByte == 0x6B   // rtl
  }

  // used for coverage marking as branch target
  public isBranch(opByte: number): boolean {
    const opDef = Isa6502.opDefs6502[opByte]
    return opDef.mode == OpMode.REL && (opDef.fc ?? false)
  }

  // used for StepOver and coverage marking as call target
  public isCall(opByte: number): boolean {
    return this.opcodes[opByte].name == "jsr"
  }

  // used for coverage marking as jump target
  public isJump(opByte: number): boolean {
    return this.opcodes[opByte].name == "jmp"
  }

  // TODO: get rid of "*" on cycle counts here
  public static opDefs6502 = [
    { val: 0x00, name: "brk", mode: OpMode.NONE, bc: 1, sf: "b",    cy: "7*",   fc: true },
    { val: 0x01, name: "ora", mode: OpMode.INDX, bc: 2, sf: "nz",   cy: "6"     },
    { val: 0x05, name: "ora", mode: OpMode.ZP,   bc: 2, sf: "nz",   cy: "3"     },
    { val: 0x06, name: "asl", mode: OpMode.ZP,   bc: 2, sf: "nzc",  cy: "5"     },
    { val: 0x08, name: "php", mode: OpMode.NONE, bc: 1, sf: "",     cy: "3"     },
    { val: 0x09, name: "ora", mode: OpMode.IMM,  bc: 2, sf: "nz",   cy: "2"     },
    { val: 0x0A, name: "asl", mode: OpMode.A,    bc: 1, sf: "nzc",  cy: "2"     },
    { val: 0x0D, name: "ora", mode: OpMode.ABS,  bc: 3, sf: "nz",   cy: "4"     },
    { val: 0x0E, name: "asl", mode: OpMode.ABS,  bc: 3, sf: "nzc",  cy: "6"     },
    { val: 0x10, name: "bpl", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0x11, name: "ora", mode: OpMode.INDY, bc: 2, sf: "nz",   cy: "5+"    },
    { val: 0x15, name: "ora", mode: OpMode.ZPX,  bc: 2, sf: "nz",   cy: "4"     },
    { val: 0x16, name: "asl", mode: OpMode.ZPX,  bc: 2, sf: "nzc",  cy: "6"     },
    { val: 0x18, name: "clc", mode: OpMode.NONE, bc: 1, sf: "c",    cy: "2"     },
    { val: 0x19, name: "ora", mode: OpMode.ABSY, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0x1D, name: "ora", mode: OpMode.ABSX, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0x1E, name: "asl", mode: OpMode.ABSX, bc: 3, sf: "nzc",  cy: "7*"    },
    { val: 0x20, name: "jsr", mode: OpMode.ABS,  bc: 3, sf: "",     cy: "6",    fc: true },
    { val: 0x21, name: "and", mode: OpMode.INDX, bc: 2, sf: "nz",   cy: "6"     },
    { val: 0x24, name: "bit", mode: OpMode.ZP,   bc: 2, sf: "nvz",  cy: "3"     },
    { val: 0x25, name: "and", mode: OpMode.ZP,   bc: 2, sf: "nz",   cy: "3"     },
    { val: 0x26, name: "rol", mode: OpMode.ZP,   bc: 2, sf: "nzc",  cy: "4"     },
    { val: 0x28, name: "plp", mode: OpMode.NONE, bc: 1, sf: "nv1bdizc", cy: "4" },
    { val: 0x29, name: "and", mode: OpMode.IMM,  bc: 2, sf: "nz",   cy: "2"     },
    { val: 0x2A, name: "rol", mode: OpMode.A,    bc: 1, sf: "nzc",  cy: "2"     },
    { val: 0x2C, name: "bit", mode: OpMode.ABS,  bc: 3, sf: "nvz",  cy: "4"     },
    { val: 0x2D, name: "and", mode: OpMode.ABS,  bc: 3, sf: "nz",   cy: "4"     },
    { val: 0x2E, name: "rol", mode: OpMode.ABS,  bc: 3, sf: "nzc",  cy: "6"     },
    { val: 0x30, name: "bmi", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0x31, name: "and", mode: OpMode.INDY, bc: 2, sf: "nz",   cy: "5+"    },
    { val: 0x35, name: "and", mode: OpMode.ZPX,  bc: 2, sf: "nz",   cy: "4"     },
    { val: 0x36, name: "rol", mode: OpMode.ZPX,  bc: 2, sf: "nzc",  cy: "6"     },
    { val: 0x38, name: "sec", mode: OpMode.NONE, bc: 1, sf: "c",    cy: "2"     },
    { val: 0x39, name: "and", mode: OpMode.ABSY, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0x3D, name: "and", mode: OpMode.ABSX, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0x3E, name: "rol", mode: OpMode.ABSX, bc: 3, sf: "nzc",  cy: "7*"    },
    { val: 0x40, name: "rti", mode: OpMode.NONE, bc: 1, sf: "nv1bdizc", cy: "6*", fc: true },
    { val: 0x41, name: "eor", mode: OpMode.INDX, bc: 2, sf: "nz",   cy: "6"     },
    { val: 0x45, name: "eor", mode: OpMode.ZP,   bc: 2, sf: "nz",   cy: "3"     },
    { val: 0x46, name: "lsr", mode: OpMode.ZP,   bc: 2, sf: "nzc",  cy: "4"     },
    { val: 0x48, name: "pha", mode: OpMode.NONE, bc: 1, sf: "",     cy: "3"     },
    { val: 0x49, name: "eor", mode: OpMode.IMM,  bc: 2, sf: "nz",   cy: "2"     },
    { val: 0x4A, name: "lsr", mode: OpMode.A,    bc: 1, sf: "nzc",  cy: "2"     },
    { val: 0x4C, name: "jmp", mode: OpMode.ABS,  bc: 3, sf: "",     cy: "3",    fc: true },
    { val: 0x4D, name: "eor", mode: OpMode.ABS,  bc: 3, sf: "nz",   cy: "4"     },
    { val: 0x4E, name: "lsr", mode: OpMode.ABS,  bc: 3, sf: "nzc",  cy: "6"     },
    { val: 0x50, name: "bvc", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0x51, name: "eor", mode: OpMode.INDY, bc: 2, sf: "nz",   cy: "5+"    },
    { val: 0x55, name: "eor", mode: OpMode.ZPX,  bc: 2, sf: "nz",   cy: "4"     },
    { val: 0x56, name: "lsr", mode: OpMode.ZPX,  bc: 2, sf: "nzc",  cy: "6"     },
    { val: 0x58, name: "cli", mode: OpMode.NONE, bc: 1, sf: "i",    cy: "2"     },
    { val: 0x59, name: "eor", mode: OpMode.ABSY, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0x5D, name: "eor", mode: OpMode.ABSX, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0x5E, name: "lsr", mode: OpMode.ABSX, bc: 3, sf: "nzc",  cy: "7*"    },
    { val: 0x60, name: "rts", mode: OpMode.NONE, bc: 1, sf: "",     cy: "6",    fc: true },
    { val: 0x61, name: "adc", mode: OpMode.INDX, bc: 2, sf: "nvzc", cy: "6*"    },
    { val: 0x65, name: "adc", mode: OpMode.ZP,   bc: 2, sf: "nvzc", cy: "3*"    },
    { val: 0x66, name: "ror", mode: OpMode.ZP,   bc: 2, sf: "nzc",  cy: "4"     },
    { val: 0x68, name: "pla", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "4"     },
    { val: 0x69, name: "adc", mode: OpMode.IMM,  bc: 2, sf: "nvzc", cy: "2*"    },
    { val: 0x6A, name: "ror", mode: OpMode.A,    bc: 1, sf: "nzc",  cy: "2"     },
    { val: 0x6C, name: "jmp", mode: OpMode.IND,  bc: 3, sf: "",     cy: "5*",   fc: true },
    { val: 0x6D, name: "adc", mode: OpMode.ABS,  bc: 3, sf: "nvzc", cy: "4*"    },
    { val: 0x6E, name: "ror", mode: OpMode.ABS,  bc: 3, sf: "nzc",  cy: "6"     },
    { val: 0x70, name: "bvs", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0x71, name: "adc", mode: OpMode.INDY, bc: 2, sf: "nvzc", cy: "5+*"   },
    { val: 0x75, name: "adc", mode: OpMode.ZPX,  bc: 2, sf: "nvzc", cy: "4*"    },
    { val: 0x76, name: "ror", mode: OpMode.ZPX,  bc: 2, sf: "nzc",  cy: "6"     },
    { val: 0x78, name: "sei", mode: OpMode.NONE, bc: 1, sf: "i",    cy: "2"     },
    { val: 0x79, name: "adc", mode: OpMode.ABSY, bc: 3, sf: "nvzc", cy: "4+*"   },
    { val: 0x7D, name: "adc", mode: OpMode.ABSX, bc: 3, sf: "nvzc", cy: "4+*"   },
    { val: 0x7E, name: "ror", mode: OpMode.ABSX, bc: 3, sf: "nzc",  cy: "7*"    },
    { val: 0x81, name: "sta", mode: OpMode.INDX, bc: 2, sf: "",     cy: "6"     },
    { val: 0x84, name: "sty", mode: OpMode.ZP,   bc: 2, sf: "",     cy: "3"     },
    { val: 0x85, name: "sta", mode: OpMode.ZP,   bc: 2, sf: "",     cy: "3"     },
    { val: 0x86, name: "stx", mode: OpMode.ZP,   bc: 2, sf: "",     cy: "3"     },
    { val: 0x88, name: "dey", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0x8A, name: "txa", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0x8C, name: "sty", mode: OpMode.ABS,  bc: 3, sf: "",     cy: "4"     },
    { val: 0x8D, name: "sta", mode: OpMode.ABS,  bc: 3, sf: "",     cy: "4"     },
    { val: 0x8E, name: "stx", mode: OpMode.ABS,  bc: 3, sf: "",     cy: "4"     },
    { val: 0x90, name: "bcc", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0x91, name: "sta", mode: OpMode.INDY, bc: 2, sf: "",     cy: "6"     },
    { val: 0x94, name: "sty", mode: OpMode.ZPX,  bc: 2, sf: "",     cy: "4"     },
    { val: 0x95, name: "sta", mode: OpMode.ZPX,  bc: 2, sf: "",     cy: "4"     },
    { val: 0x96, name: "stx", mode: OpMode.ZPY,  bc: 2, sf: "",     cy: "4"     },
    { val: 0x98, name: "tya", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0x99, name: "sta", mode: OpMode.ABSY, bc: 3, sf: "",     cy: "5"     },
    { val: 0x9A, name: "txs", mode: OpMode.NONE, bc: 1, sf: "",     cy: "2"     },
    { val: 0x9D, name: "sta", mode: OpMode.ABSX, bc: 3, sf: "",     cy: "5"     },
    { val: 0xA0, name: "ldy", mode: OpMode.IMM,  bc: 2, sf: "nz",   cy: "2"     },
    { val: 0xA1, name: "lda", mode: OpMode.INDX, bc: 2, sf: "nz",   cy: "6"     },
    { val: 0xA2, name: "ldx", mode: OpMode.IMM,  bc: 2, sf: "nz",   cy: "2"     },
    { val: 0xA4, name: "ldy", mode: OpMode.ZP,   bc: 2, sf: "nz",   cy: "3"     },
    { val: 0xA5, name: "lda", mode: OpMode.ZP,   bc: 2, sf: "nz",   cy: "3"     },
    { val: 0xA6, name: "ldx", mode: OpMode.ZP,   bc: 2, sf: "nz",   cy: "3"     },
    { val: 0xA8, name: "tay", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0xA9, name: "lda", mode: OpMode.IMM,  bc: 2, sf: "nz",   cy: "2"     },
    { val: 0xAA, name: "tax", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0xAC, name: "ldy", mode: OpMode.ABS,  bc: 3, sf: "nz",   cy: "4"     },
    { val: 0xAD, name: "lda", mode: OpMode.ABS,  bc: 3, sf: "nz",   cy: "4"     },
    { val: 0xAE, name: "ldx", mode: OpMode.ABS,  bc: 3, sf: "nz",   cy: "4"     },
    { val: 0xB0, name: "bcs", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0xB1, name: "lda", mode: OpMode.INDY, bc: 2, sf: "nz",   cy: "5+"    },
    { val: 0xB4, name: "ldy", mode: OpMode.ZPX,  bc: 2, sf: "nz",   cy: "4"     },
    { val: 0xB5, name: "lda", mode: OpMode.ZPX,  bc: 2, sf: "nz",   cy: "4"     },
    { val: 0xB6, name: "ldx", mode: OpMode.ZPY,  bc: 2, sf: "nz",   cy: "4"     },
    { val: 0xB8, name: "clv", mode: OpMode.NONE, bc: 1, sf: "v",    cy: "2"     },
    { val: 0xB9, name: "lda", mode: OpMode.ABSY, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0xBA, name: "tsx", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0xBC, name: "ldy", mode: OpMode.ABSX, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0xBD, name: "lda", mode: OpMode.ABSX, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0xBE, name: "ldx", mode: OpMode.ABSY, bc: 3, sf: "nz",   cy: "4+"    },
    { val: 0xC0, name: "cpy", mode: OpMode.IMM,  bc: 2, sf: "nzc",  cy: "2"     },
    { val: 0xC1, name: "cmp", mode: OpMode.INDX, bc: 2, sf: "nzc",  cy: "6"     },
    { val: 0xC4, name: "cpy", mode: OpMode.ZP,   bc: 2, sf: "nzc",  cy: "3"     },
    { val: 0xC5, name: "cmp", mode: OpMode.ZP,   bc: 2, sf: "nzc",  cy: "3"     },
    { val: 0xC6, name: "dec", mode: OpMode.ZP,   bc: 2, sf: "nz",   cy: "5"     },  // *** cy: 5 for 6502, 4 for 65c02
    { val: 0xC8, name: "iny", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0xC9, name: "cmp", mode: OpMode.IMM,  bc: 2, sf: "nzc",  cy: "2"     },
    { val: 0xCA, name: "dex", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0xCC, name: "cpy", mode: OpMode.ABS,  bc: 3, sf: "nzc",  cy: "4"     },
    { val: 0xCD, name: "cmp", mode: OpMode.ABS,  bc: 3, sf: "nzc",  cy: "4"     },
    { val: 0xCE, name: "dec", mode: OpMode.ABS,  bc: 3, sf: "nz",   cy: "6"     },
    { val: 0xD0, name: "bne", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0xD1, name: "cmp", mode: OpMode.INDY, bc: 2, sf: "nzc",  cy: "5+"    },
    { val: 0xD5, name: "cmp", mode: OpMode.ZPX,  bc: 2, sf: "nzc",  cy: "4"     },
    { val: 0xD6, name: "dec", mode: OpMode.ZPX,  bc: 2, sf: "nz",   cy: "6"     },
    { val: 0xD8, name: "cld", mode: OpMode.NONE, bc: 1, sf: "d",    cy: "2"     },
    { val: 0xD9, name: "cmp", mode: OpMode.ABSY, bc: 3, sf: "nzc",  cy: "4+"    },
    { val: 0xDD, name: "cmp", mode: OpMode.ABSX, bc: 3, sf: "nzc",  cy: "4+"    },
    { val: 0xDE, name: "dec", mode: OpMode.ABSX, bc: 3, sf: "nz",   cy: "7"     },
    { val: 0xE0, name: "cpx", mode: OpMode.IMM,  bc: 2, sf: "nzc",  cy: "2"     },
    { val: 0xE1, name: "sbc", mode: OpMode.INDX, bc: 2, sf: "nvzc", cy: "6*"    },
    { val: 0xE4, name: "cpx", mode: OpMode.ZP,   bc: 2, sf: "nzc",  cy: "3"     },
    { val: 0xE5, name: "sbc", mode: OpMode.ZP,   bc: 2, sf: "nvzc", cy: "3*"    },
    { val: 0xE6, name: "inc", mode: OpMode.ZP,   bc: 2, sf: "nz",   cy: "4"     },
    { val: 0xE8, name: "inx", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"     },
    { val: 0xE9, name: "sbc", mode: OpMode.IMM,  bc: 2, sf: "nvzc", cy: "2*"    },
    { val: 0xEA, name: "nop", mode: OpMode.NONE, bc: 1, sf: "",     cy: "2"     },
    { val: 0xEC, name: "cpx", mode: OpMode.ABS,  bc: 3, sf: "nzc",  cy: "4"     },
    { val: 0xED, name: "sbc", mode: OpMode.ABS,  bc: 3, sf: "nvzc", cy: "4*"    },
    { val: 0xEE, name: "inc", mode: OpMode.ABS,  bc: 3, sf: "nz",   cy: "6"     },
    { val: 0xF0, name: "beq", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0xF1, name: "sbc", mode: OpMode.INDY, bc: 2, sf: "nvzc", cy: "5+*"   },
    { val: 0xF5, name: "sbc", mode: OpMode.ZPX,  bc: 2, sf: "nvzc", cy: "4*"    },
    { val: 0xF6, name: "inc", mode: OpMode.ZPX,  bc: 2, sf: "nz",   cy: "6"     },
    { val: 0xF8, name: "sed", mode: OpMode.NONE, bc: 1, sf: "d",    cy: "2"     },
    { val: 0xF9, name: "sbc", mode: OpMode.ABSY, bc: 3, sf: "nvzc", cy: "4+*"   },
    { val: 0xFD, name: "sbc", mode: OpMode.ABSX, bc: 3, sf: "nvzc", cy: "4+*"   },
    { val: 0xFE, name: "inc", mode: OpMode.ABSX, bc: 3, sf: "nz",   cy: "7"     },
  ]

  // TODO: add aliases?
  private static opDescs6502 = new Map<string, string>([
    [ "adc", "Add with Carry" ],
    [ "and", "Logical AND" ],
    [ "asl", "Arithmetic Shift Left" ],
    [ "bcc", "Branch on Carry Clear" ],
    [ "bcs", "Branch on Carry Set" ],
    [ "beq", "Branch on Equal" ],
    [ "bit", "Bit Test" ],
    [ "bmi", "Branch on Minus" ],
    [ "bne", "Branch on Not Equal" ],
    [ "bpl", "Branch on Plus" ],
    [ "brk", "Break interrupt" ],
    [ "bvc", "Branch on Overflow Clear" ],
    [ "bvs", "Branch on Overflow Set" ],
    [ "clc", "Clear Carry" ],
    [ "cld", "Clear Decimal Mode" ],
    [ "cli", "Clear Interrupt Disable" ],
    [ "clv", "Clear Overflow" ],
    [ "cmp", "Compare Accumulator" ],
    [ "cpx", "Compare X Register" ],
    [ "cpy", "Compare Y Register" ],
    [ "dec", "Decrement Memory" ],
    [ "dex", "Decrement X Register" ],
    [ "dey", "Decrement Y Register" ],
    [ "eor", "Exclusive OR" ],
    [ "inc", "Increment Memory" ],
    [ "inx", "Increment X Register" ],
    [ "iny", "Increment Y Register" ],
    [ "jmp", "Jump" ],
    [ "jsr", "Jump to Subroutine" ],
    [ "lda", "Load Accumulator" ],
    [ "ldx", "Load X Register" ],
    [ "ldy", "Load Y Register" ],
    [ "lsr", "Logical Shift Right" ],
    [ "nop", "No Operation" ],
    [ "ora", "Logical OR" ],
    [ "pha", "Push Accumulator" ],
    [ "php", "Push Processor Status" ],
    [ "pla", "Pull Accumulator" ],
    [ "plp", "Pull Processor Status" ],
    [ "rol", "Rotate left" ],
    [ "ror", "Rotate right" ],
    [ "rti", "Return from Interrupt" ],
    [ "rts", "Return from Subroutine" ],
    [ "sbc", "Subtract with Carry" ],
    [ "sec", "Set Carry" ],
    [ "sed", "Set Decimal Mode" ],
    [ "sei", "Set Interrupt Disable" ],
    [ "sta", "Store Accumulator" ],
    [ "stx", "Store X Register" ],
    [ "sty", "Store Y Register" ],
    [ "tax", "Transfer Accumulator to X" ],
    [ "tay", "Transfer Accumulator to Y" ],
    [ "tsx", "Transfer Stack Pointer to X" ],
    [ "txa", "Transfer X to Accumulator" ],
    [ "txs", "Transfer X to Stack Pointer" ],
    [ "tya", "Transfer Y to Accumulator" ]
  ])
}

//------------------------------------------------------------------------------

export class Isa65C02 extends Isa6502 {
  constructor() {
    super()
    this.BuildOpcodes(Isa65C02.ops65C02)
  }

  public getDescByName(name: string): string {
    let desc = Isa65C02.opDescs65C02.get(name)
    if (!desc) {
      desc = super.getDescByName(name)
    }
    return desc
  }

  // *** update some cycle counts that changed from 6502 ***
  private static ops65C02 = [
    { val: 0x04, name: "tsb", mode: OpMode.ZP,   bc: 2, sf: "z",    cy: "5"     },
    { val: 0x0C, name: "tsb", mode: OpMode.ABS,  bc: 3, sf: "z",    cy: "6"     },
    { val: 0x12, name: "ora", mode: OpMode.INZ,  bc: 2, sf: "nz",   cy: "5"     },
    { val: 0x14, name: "trb", mode: OpMode.ZP,   bc: 2, sf: "z",    cy: "5"     },
    { val: 0x1A, name: "inc", mode: OpMode.A,    bc: 2, sf: "nz",   cy: "2"     },
    { val: 0x1C, name: "trb", mode: OpMode.ABS,  bc: 3, sf: "z",    cy: "6"     },
    { val: 0x32, name: "and", mode: OpMode.INZ,  bc: 2, sf: "nz",   cy: "5"     },
    { val: 0x34, name: "bit", mode: OpMode.ZPX,  bc: 2, sf: "nvz",  cy: "4"     },
    { val: 0x3A, name: "dec", mode: OpMode.A,    bc: 2, sf: "nz",   cy: "2"     },
    { val: 0x3C, name: "bit", mode: OpMode.ABSX, bc: 3, sf: "nvz",  cy: "4+"    },
    { val: 0x52, name: "eor", mode: OpMode.INZ,  bc: 2, sf: "nz",   cy: "5"     },
    { val: 0x5A, name: "phy", mode: OpMode.NONE, bc: 1, sf: "",     cy: "3"     },
    { val: 0x64, name: "stz", mode: OpMode.ZP,   bc: 2, sf: "",     cy: "3"     },
    { val: 0x72, name: "adc", mode: OpMode.INZ,  bc: 2, sf: "nvzc", cy: "5*"    },
    { val: 0x74, name: "stz", mode: OpMode.ZPX,  bc: 2, sf: "",     cy: "4"     },
    { val: 0x7A, name: "ply", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "4"     },
    { val: 0x7C, name: "jmp", mode: OpMode.AXI,  bc: 3, sf: "",     cy: "6",    fc: true },
    { val: 0x80, name: "bra", mode: OpMode.REL,  bc: 2, sf: "",     cy: "2/3+", fc: true },
    { val: 0x89, name: "bit", mode: OpMode.IMM,  bc: 2, sf: "z",    cy: "2"     },
    { val: 0x92, name: "sta", mode: OpMode.INZ,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x9C, name: "stz", mode: OpMode.ABS,  bc: 3, sf: "",     cy: "4"     },
    { val: 0x9E, name: "stz", mode: OpMode.ABSX, bc: 3, sf: "",     cy: "5"     },
    { val: 0xB2, name: "lda", mode: OpMode.INZ,  bc: 2, sf: "nz",   cy: "5"     },
    { val: 0xCB, name: "wai", mode: OpMode.NONE, bc: 1, sf: "",     cy: "3"     },
    { val: 0xD2, name: "cmp", mode: OpMode.INZ,  bc: 2, sf: "nzc",  cy: "5"     },
    { val: 0xDA, name: "phx", mode: OpMode.NONE, bc: 1, sf: "",     cy: "3"     },
    { val: 0xDB, name: "stp", mode: OpMode.NONE, bc: 1, sf: "",     cy: "3"     },
    { val: 0xF2, name: "sbc", mode: OpMode.INZ,  bc: 2, sf: "nzc",  cy: "5*"    },
    { val: 0xFA, name: "plx", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "4"     },

    // cycle count changed when addressing bug fixed
    { val: 0x6C, name: "jmp", mode: OpMode.IND,  bc: 3, sf: "",     cy: "6",   fc: true },

    { val: 0x07, name: "rmb0", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x17, name: "rmb1", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x27, name: "rmb2", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x37, name: "rmb3", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x47, name: "rmb4", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x57, name: "rmb5", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x67, name: "rmb6", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x77, name: "rmb7", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x87, name: "smb0", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0x97, name: "smb1", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0xa7, name: "smb2", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0xb7, name: "smb3", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0xc7, name: "smb4", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0xd7, name: "smb5", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0xe7, name: "smb6", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },
    { val: 0xf7, name: "smb7", mode: OpMode.ZP,  bc: 2, sf: "",     cy: "5"     },

    { val: 0x0f, name: "bbr0", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x1f, name: "bbr1", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x2f, name: "bbr2", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x3f, name: "bbr3", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x4f, name: "bbr4", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x5f, name: "bbr5", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x6f, name: "bbr6", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x7f, name: "bbr7", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x8f, name: "bbs0", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0x9f, name: "bbs1", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0xaf, name: "bbs2", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0xbf, name: "bbs3", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0xcf, name: "bbs4", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0xdf, name: "bbs5", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0xef, name: "bbs6", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    { val: 0xff, name: "bbs7", mode: OpMode.ZP_REL, bc: 3, sf: "",  cy: "5*",   fc: true },
    // + 1 cycle for branch taken, + 1 for branch crossing page

    { val: 0x02, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0x22, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0x42, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0x62, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0x82, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0xc2, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0xe2, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0x44, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0x54, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0xd4, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },
    { val: 0xf4, name: "nop",  mode: OpMode.ZP,     bc: 2, sf: "",  cy: "2"     },

    { val: 0x5c, name: "nop",  mode: OpMode.ABS,    bc: 3, sf: "",  cy: "8"     },
    { val: 0xdc, name: "nop",  mode: OpMode.ABS,    bc: 3, sf: "",  cy: "4"     },
    { val: 0xfc, name: "nop",  mode: OpMode.ABS,    bc: 3, sf: "",  cy: "4"     },

    { val: 0x03, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x13, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x23, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x33, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x43, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x53, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x63, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x73, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x83, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x93, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xa3, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xb3, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xc3, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xd3, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xe3, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xf3, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x0b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x1b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x2b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x3b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x4b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x5b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x6b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x7b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x8b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0x9b, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xab, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xbb, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xeb, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
    { val: 0xfb, name: "nop1",  mode: OpMode.NONE,  bc: 1, sf: "",  cy: "1"     },
  ]

  // TODO: add aliases?
  private static opDescs65C02 = new Map<string, string>([
    [ "bra", "Branch Always" ],
    [ "phx", "Push X Register" ],
    [ "phy", "Push Y Register" ],
    [ "plx", "Pull X Register" ],
    [ "ply", "Pull Y Register" ],
    [ "stz", "Store Zero" ],
    [ "trb", "Test and Reset Bits" ],
    [ "tsb", "Test and Set Bits" ],

    [ "stp", "Stop" ],
    [ "wai", "Wait for interrupt" ],

    [ "rmb0", "Reset Memory Bit" ],
    [ "rmb1", "Reset Memory Bit" ],
    [ "rmb2", "Reset Memory Bit" ],
    [ "rmb3", "Reset Memory Bit" ],
    [ "rmb4", "Reset Memory Bit" ],
    [ "rmb5", "Reset Memory Bit" ],
    [ "rmb6", "Reset Memory Bit" ],
    [ "rmb7", "Reset Memory Bit" ],

    [ "smb0", "Set Memory Bit" ],
    [ "smb1", "Set Memory Bit" ],
    [ "smb2", "Set Memory Bit" ],
    [ "smb3", "Set Memory Bit" ],
    [ "smb4", "Set Memory Bit" ],
    [ "smb5", "Set Memory Bit" ],
    [ "smb6", "Set Memory Bit" ],
    [ "smb7", "Set Memory Bit" ],

    [ "bbr0", "Branch on Bit Reset" ],
    [ "bbr1", "Branch on Bit Reset" ],
    [ "bbr2", "Branch on Bit Reset" ],
    [ "bbr3", "Branch on Bit Reset" ],
    [ "bbr4", "Branch on Bit Reset" ],
    [ "bbr5", "Branch on Bit Reset" ],
    [ "bbr6", "Branch on Bit Reset" ],
    [ "bbr7", "Branch on Bit Reset" ],

    [ "bbs0", "Branch on Bit Set" ],
    [ "bbs1", "Branch on Bit Set" ],
    [ "bbs2", "Branch on Bit Set" ],
    [ "bbs3", "Branch on Bit Set" ],
    [ "bbs4", "Branch on Bit Set" ],
    [ "bbs5", "Branch on Bit Set" ],
    [ "bbs6", "Branch on Bit Set" ],
    [ "bbs7", "Branch on Bit Set" ],

    [ "nop1", "No Operation, 1 byte, 1 cycle" ],
  ])
}

//------------------------------------------------------------------------------

class Isa65816 extends Isa65C02 {
  constructor() {
    super()
    this.BuildOpcodes(Isa65816.ops65816)
  }

  public getDescByName(name: string): string {
    let desc = Isa65816.opDescs65816.get(name)
    if (!desc) {
      desc = super.getDescByName(name)
    }
    return desc
  }

  // TODO: update cycle counts?
  // TODO: reorder into columns?
  private static ops65816 = [
    { val: 0x02, name: "cop", mode: OpMode.IMM,  bc: 1, sf: "di",   cy: "8",   fc: true },
    { val: 0x03, name: "ora", mode: OpMode.STS,  bc: 2, sf: "nz",   cy: "4m"   },
    { val: 0x07, name: "ora", mode: OpMode.LIN,  bc: 2, sf: "nz",   cy: "6m+"  },
    { val: 0x0B, name: "phd", mode: OpMode.NONE, bc: 1, sf: "",     cy: "4"    },
    { val: 0x0F, name: "ora", mode: OpMode.LABS, bc: 4, sf: "nz",   cy: "5m"   },
    { val: 0x13, name: "ora", mode: OpMode.SIY,  bc: 2, sf: "nz",   cy: "7m"   },
    { val: 0x17, name: "ora", mode: OpMode.LIY,  bc: 2, sf: "nz",   cy: "6m+"  },
    { val: 0x1B, name: "tcs", mode: OpMode.NONE, bc: 1, sf: "",     cy: "2"    },
    { val: 0x1F, name: "ora", mode: OpMode.LABX, bc: 4, sf: "nz",   cy: "5m"   },
    { val: 0x22, name: "jsl", mode: OpMode.LABS, bc: 4, sf: "",     cy: "8",   fc: true },
    { val: 0x23, name: "and", mode: OpMode.STS,  bc: 3, sf: "nz",   cy: "4m"   },
    { val: 0x27, name: "and", mode: OpMode.LIN,  bc: 2, sf: "nz",   cy: "6m+"  },
    { val: 0x2B, name: "pld", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "5"    },
    { val: 0x2F, name: "and", mode: OpMode.LABS, bc: 4, sf: "nz",   cy: "5m"   },
    { val: 0x33, name: "and", mode: OpMode.SIY,  bc: 2, sf: "nz",   cy: "7m"   },
    { val: 0x37, name: "and", mode: OpMode.LIY,  bc: 2, sf: "nz",   cy: "6m+"  },
    { val: 0x3B, name: "tsc", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"    },
    { val: 0x3F, name: "and", mode: OpMode.LABX, bc: 4, sf: "nz",   cy: "5m"   },
    { val: 0x42, name: "wdm", mode: OpMode.IMM,  bc: 2, sf: "",     cy: "2"    },
    { val: 0x43, name: "eor", mode: OpMode.STS,  bc: 2, sf: "nz",   cy: "4m"   },
    { val: 0x44, name: "mvp", mode: OpMode.SD,   bc: 3, sf: "",     cy: "7"    },
    { val: 0x47, name: "eor", mode: OpMode.LIN,  bc: 2, sf: "nz",   cy: "6m+"  },
    { val: 0x4B, name: "phk", mode: OpMode.NONE, bc: 1, sf: "",     cy: "3"    },
    { val: 0x4F, name: "eor", mode: OpMode.LABS, bc: 4, sf: "nz",   cy: "5m"   },
    { val: 0x53, name: "eor", mode: OpMode.SIY,  bc: 2, sf: "nz",   cy: "7m"   },
    { val: 0x54, name: "mvn", mode: OpMode.SD,   bc: 3, sf: "",     cy: "7"    },
    { val: 0x57, name: "eor", mode: OpMode.LIY,  bc: 2, sf: "nz",   cy: "6m+"  },
    { val: 0x5B, name: "tcd", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"    },
    { val: 0x5C, name: "jmp", mode: OpMode.LABS, bc: 4, sf: "",     cy: "4",   fc: true },
    { val: 0x5F, name: "eor", mode: OpMode.LABX, bc: 4, sf: "nz",   cy: "5m"   },
    { val: 0x62, name: "per", mode: OpMode.LREL, bc: 3, sf: "",     cy: "6"    },
    { val: 0x63, name: "adc", mode: OpMode.STS,  bc: 2, sf: "nvzc", cy: "4m"   },
    { val: 0x67, name: "adc", mode: OpMode.LIN,  bc: 2, sf: "nvzc", cy: "6m"   },
    { val: 0x6B, name: "rtl", mode: OpMode.NONE, bc: 1, sf: "",     cy: "6",   fc: true },
    { val: 0x6F, name: "adc", mode: OpMode.LABS, bc: 4, sf: "nvzc", cy: "5m"   },
    { val: 0x73, name: "adc", mode: OpMode.SIY,  bc: 2, sf: "nvzc", cy: "7m"   },
    { val: 0x77, name: "adc", mode: OpMode.LIY,  bc: 2, sf: "nvzc", cy: "6m+"  },
    { val: 0x7B, name: "tdc", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"    },
    { val: 0x7F, name: "adc", mode: OpMode.LABX, bc: 4, sf: "nvzc", cy: "5m"   },
    { val: 0x82, name: "brl", mode: OpMode.LREL, bc: 3, sf: "",     cy: "4",   fc: true },
    { val: 0x83, name: "sta", mode: OpMode.STS,  bc: 2, sf:"",      cy: "4m"   },
    { val: 0x87, name: "sta", mode: OpMode.LIN,  bc: 2, sf: "",     cy: "6m+"  },
    { val: 0x8B, name: "phb", mode: OpMode.NONE, bc: 1, sf: "",     cy: "3"    },
    { val: 0x8F, name: "sta", mode: OpMode.LABS, bc: 4, sf: "",     cy: "5m"   },
    { val: 0x93, name: "sta", mode: OpMode.SIY,  bc: 2, sf: "",     cy: "7m"   },
    { val: 0x97, name: "sta", mode: OpMode.LIY,  bc: 2, sf: "",     cy: "6m+"  },
    { val: 0x9B, name: "txy", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"    },
    { val: 0x9F, name: "sta", mode: OpMode.LABX, bc: 4, sf: "",     cy: "5m"   },
    { val: 0xA3, name: "lda", mode: OpMode.STS,  bc: 2, sf: "nz",   cy: "4m"   },
    { val: 0xA7, name: "lda", mode: OpMode.LIN,  bc: 2, sf: "nz",   cy: "6m+"  },
    { val: 0xAB, name: "plb", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "4"    },
    { val: 0xAF, name: "lda", mode: OpMode.LABS, bc: 4, sf: "nz",   cy: "5m"   },
    { val: 0xB3, name: "lda", mode: OpMode.SIY,  bc: 2, sf: "nz",   cy: "7m"   },
    { val: 0xB7, name: "lda", mode: OpMode.LIY,  bc: 2, sf: "nz",   cy: "6m+"  },
    { val: 0xBB, name: "tyx", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "2"    },
    { val: 0xBF, name: "lda", mode: OpMode.LABX, bc: 4, sf: "nz",   cy: "5m"   },
    { val: 0xC2, name: "rep", mode: OpMode.IMM,  bc: 2, sf: "*",    cy: "3"    },
    { val: 0xC3, name: "cmp", mode: OpMode.STS,  bc: 2, sf: "nzc",  cy: "4m"   },
    { val: 0xC7, name: "cmp", mode: OpMode.LIN,  bc: 2, sf: "nzc",  cy: "6m+"  },
    { val: 0xCF, name: "cmp", mode: OpMode.LABS, bc: 4, sf: "nzc",  cy: "5m"   },
    { val: 0xD3, name: "cmp", mode: OpMode.SIY,  bc: 2, sf: "nzc",  cy: "7m"   },
    { val: 0xD4, name: "pei", mode: OpMode.ZP,   bc: 2, sf: "",     cy: "6+"   },
    { val: 0xD7, name: "cmp", mode: OpMode.LIY,  bc: 2, sf: "nzc",  cy: "6m+"  },
    { val: 0xDC, name: "jmp", mode: OpMode.ALI,  bc: 3, sf: "",     cy: "6",   fc: true },
    { val: 0xDF, name: "cmp", mode: OpMode.LABX, bc: 4, sf: "nzc",  cy: "5m"   },
    { val: 0xE2, name: "sep", mode: OpMode.IMM,  bc: 2, sf: "*",    cy: "3"    },
    { val: 0xE3, name: "sbc", mode: OpMode.STS,  bc: 2, sf: "nvzc", cy: "4m"   },
    { val: 0xE7, name: "sbc", mode: OpMode.LIN,  bc: 2, sf: "nvzc", cy: "6m"   },
    { val: 0xEB, name: "xba", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "3"    },
    { val: 0xEF, name: "sbc", mode: OpMode.LABS, bc: 4, sf: "nvzc", cy: "5m"   },
    { val: 0xF3, name: "sbc", mode: OpMode.SIY,  bc: 2, sf: "nvzc", cy: "7m"   },
    { val: 0xF4, name: "pea", mode: OpMode.ABS,  bc: 3, sf: "",     cy: "5"    }, // TODO: OpMode.IMM too?
    { val: 0xF7, name: "sbc", mode: OpMode.LIY,  bc: 2, sf: "nvzc", cy: "6m+"  },
    { val: 0xFB, name: "xce", mode: OpMode.NONE, bc: 1, sf: "c",    cy: "2"    },
    { val: 0xFC, name: "jsr", mode: OpMode.AXI,  bc: 3, sf: "",     cy: "8",   fc: true },
    { val: 0xFF, name: "sbc", mode: OpMode.LABX, bc: 4, sf: "nvzc", cy: "5m"   }
  ]

  // TODO: add aliases?
  private static opDescs65816 = new Map<string, string>([
    [ "brl", "Branch Long" ],
    [ "cop", "Coprocessor" ],
    [ "jsl", "Jump to Subroutine Long" ],
    [ "mvn", "Move Memory Negative" ],
    [ "mvp", "Move Memory Positive" ],
    [ "pea", "Push Effective Address" ],
    [ "pei", "Push Effective Indirect Address" ],
    [ "per", "Push Effective Relative Address" ],
    [ "phb", "Push Data Bank Register" ],
    [ "phd", "Push Direct Register" ],
    [ "phk", "Push K Register" ],
    [ "pld", "Pull Direct Register" ],
    [ "plb", "Pull Data Bank Register" ],
    [ "rep", "Reset Processor Status Bits" ],
    [ "rtl", "Return from Subroutine Long" ],
    [ "sep", "Set Processor Status Bits" ],
    [ "stp", "Stop the Clock" ],
    [ "tcd", "Transfer C Accumulator to Direct Register" ],
    [ "tcs", "Transfer C Accumulator to Stack Pointer" ],
    [ "tdc", "Transfer Direct Register to C Accumulator" ],
    [ "tsc", "Transfer Stack Pointer to C Accumulator" ],
    [ "txy", "Transfer X Register to Y Register" ],
    [ "tyx", "Transfer Y Register to X Register" ],
    [ "wai", "Wait for Interrupt" ],
    [ "wdm", "William D Mensch Jr." ],
    [ "xba", "Exchange B and A Accumulator" ],
    [ "xce", "Exchange Carry and Emulator Flags" ],
  ])
}

//------------------------------------------------------------------------------

class Isa65EL02 extends Isa65816 {
  constructor() {
    super()
    this.BuildOpcodes(Isa65EL02.ops65EL02)
  }

  public getDescByName(name: string): string {
    let desc = Isa65EL02.opDescs65EL02.get(name)
    if (!desc) {
      desc = super.getDescByName(name)
    }
    return desc
  }

  // TODO: fill in cycle times
  private static ops65EL02 = [
    { val: 0x02, name: "nxt", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0",   fc: true },
    { val: 0x22, name: "ent", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0"    },
    { val: 0x42, name: "nxa", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0",   },
    { val: 0x82, name: "rer", mode: OpMode.REL,  bc: 2, sf: "",     cy: "0",   },

    { val: 0x44, name: "rea", mode: OpMode.ABS,  bc: 9, sf: "xx",   cy: "0",   fc: false },
    { val: 0x54, name: "rei", mode: OpMode.ZP,   bc: 9, sf: "xx",   cy: "0",   fc: false },

    { val: 0x07, name: "ora", mode: OpMode.STR,  bc: 2, sf: "nz",   cy: "0"    },
    { val: 0x17, name: "ora", mode: OpMode.RIY,  bc: 2, sf: "nz",   cy: "0"    },
    { val: 0x27, name: "and", mode: OpMode.STR,  bc: 2, sf: "nz",   cy: "0"    },
    { val: 0x37, name: "and", mode: OpMode.RIY,  bc: 2, sf: "nz",   cy: "0"    },
    { val: 0x47, name: "eor", mode: OpMode.STR,  bc: 2, sf: "nz",   cy: "0"    },
    { val: 0x57, name: "eor", mode: OpMode.RIY,  bc: 2, sf: "nz",   cy: "0"    },
    { val: 0x67, name: "adc", mode: OpMode.STR,  bc: 2, sf: "nvzc", cy: "0"    },
    { val: 0x77, name: "adc", mode: OpMode.RIY,  bc: 2, sf: "nvzc", cy: "0"    },
    { val: 0x87, name: "sta", mode: OpMode.STR,  bc: 2, sf: "",     cy: "0"    },
    { val: 0x97, name: "sta", mode: OpMode.RIY,  bc: 2, sf: "",     cy: "0"    },
    { val: 0xA7, name: "lda", mode: OpMode.STR,  bc: 2, sf: "nz",   cy: "0"    },
    { val: 0xB7, name: "lda", mode: OpMode.RIY,  bc: 2, sf: "nz",   cy: "0"    },
    { val: 0xC7, name: "cmp", mode: OpMode.STR,  bc: 2, sf: "nzc",  cy: "0"    },
    { val: 0xD7, name: "cmp", mode: OpMode.RIY,  bc: 2, sf: "nzc",  cy: "0"    },
    { val: 0xE7, name: "sbc", mode: OpMode.STR,  bc: 2, sf: "nvzc", cy: "0"    },
    { val: 0xF7, name: "sbc", mode: OpMode.RIY,  bc: 2, sf: "nvzc", cy: "0"    },

    { val: 0x0B, name: "rhi", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0"    },
    { val: 0x1B, name: "rhx", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0"    },
    { val: 0x2B, name: "rli", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0x3B, name: "rlx", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0x4B, name: "rha", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0"    },
    { val: 0x5B, name: "rhy", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0"    },
    { val: 0x6B, name: "rla", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0x7B, name: "rly", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0x8B, name: "txr", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0xAB, name: "trx", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },

    { val: 0x5C, name: "txi", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0xDC, name: "tix", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },

    { val: 0x0F, name: "mul", mode: OpMode.ZP,   bc: 2, sf: "nzo",  cy: "0"    },
    { val: 0x1F, name: "mul", mode: OpMode.ZPX,  bc: 2, sf: "nzo",  cy: "0"    },
    { val: 0x2F, name: "mul", mode: OpMode.ABS,  bc: 3, sf: "nzo",  cy: "0"    },
    { val: 0x3F, name: "mul", mode: OpMode.ABSX, bc: 3, sf: "nzo",  cy: "0"    },
    { val: 0x4F, name: "div", mode: OpMode.ZP,   bc: 2, sf: "nzo",  cy: "0"    },
    { val: 0x5F, name: "div", mode: OpMode.ZPX,  bc: 2, sf: "nzo",  cy: "0"    },
    { val: 0x6F, name: "div", mode: OpMode.ABS,  bc: 3, sf: "nzo",  cy: "0"    },
    { val: 0x7F, name: "div", mode: OpMode.ABSX, bc: 3, sf: "nzo",  cy: "0"    },
    { val: 0x8F, name: "zea", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0"    },
    { val: 0x9F, name: "sea", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0"    },
    { val: 0xAF, name: "tda", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0xBF, name: "tad", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0xCF, name: "pld", mode: OpMode.NONE, bc: 1, sf: "nz",   cy: "0"    },
    { val: 0xDF, name: "phd", mode: OpMode.NONE, bc: 1, sf: "",     cy: "0"    },
    { val: 0xEF, name: "mmu", mode: OpMode.IMM,  bc: 9, sf: "",     cy: "0"    },
  ]

  // TODO: add aliases?
  private static opDescs65EL02 = new Map<string, string>([
    [ "div", "Signed Divide D:A, Quotient in A, Remainder in D" ],
    [ "ent", "Enter Word" ],
    [ "mmu", "Prefix for MMU Manipulation" ],
    [ "mul", "Signed Multiply A into D:A" ],
    [ "nxa", "Next Word into A" ],
    [ "nxt", "Next Word" ],
    [ "phd", "Push D Register on Stack" ],
    [ "pld", "Pull D Register from Stack" ],
    [ "rer", "Push Effective Relative Address to R Stack" ],
    [ "rha", "Push Accmulator to R Stack" ],
    [ "rhi", "Push I Register to R Stack" ],
    [ "rhx", "Push X Register to R Stack" ],
    [ "rhy", "Push Y Register to R Stack" ],
    [ "rla", "Pull Accmulator from R Stack" ],
    [ "rli", "Pull I Register from R Stack" ],
    [ "rlx", "Pull X Register from R Stack" ],
    [ "rly", "Pull Y Register from R Stack" ],
    [ "sea", "Sign Extend A into D:A" ],
    [ "tad", "Transfer A to D" ],
    [ "tda", "Transfer D to A" ],
    [ "tix", "Transfer I to X" ],
    [ "trx", "Transfer R to X" ],
    [ "txi", "Transfer X to I" ],
    [ "txr", "Transfer X to R" ],
    [ "zea", "Zero Extend A into D:A" ],
  ])
}

//------------------------------------------------------------------------------

export class IsaSet65xx implements IsaSet {

  private isaMap = new Map<string, Isa>()

  getIsa(name: string): Isa {
    let isa = this.isaMap.get(name)
    if (!isa) {
      switch (name) {
        default:
        case "6502":
          isa = new Isa6502()
          break
        case "65c02":
          isa = new Isa65C02()
          break
        case "65816":
          isa = new Isa65816()
          break
        case "65el02":
          isa = new Isa65EL02()
          break
      }
      this.isaMap.set(name, isa)
    }
    return isa
  }
}

export const isaSet65xx = new IsaSet65xx()

//------------------------------------------------------------------------------

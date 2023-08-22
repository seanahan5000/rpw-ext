
import * as stm from "./statements"

export const Keywords = {
  "ORG":        { syntax: [ "MERL", "DASM", "LISA" ] },
  // TODO: EQU and "=" for all syntaxes?
  "EQU":        { syntax: [ "MERL", "DASM", "LISA" ], create: () => { return new stm.EquStatement() }},
  "=":          { syntax: [ "MERL", "DASM", "LISA" ], create: () => { return new stm.EquStatement() }},
  "ERR":        { syntax: [ "MERL", "DASM"         ], create: () => { return new stm.ErrorStatement() }},

  "PUT":        { syntax: [ "MERL"                 ], create: () => { return new stm.IncludeStatement() }},
  "USE":        { syntax: [ "MERL"                 ], create: () => { return new stm.IncludeStatement() }},
  "INCLUDE":    { syntax: [         "DASM"         ], create: () => { return new stm.IncludeStatement() }},
  "SAV":        { syntax: [ "MERL",         "LISA" ] },
  "DSK":        { syntax: [ "MERL"                 ] },

  "MAC":        { syntax: [ "MERL", "DASM"         ] },
  "EOM":        { syntax: [ "MERL"                 ] },
  "ENDM":       { syntax: [         "DASM"         ] },
  "SEG":        { syntax: [         "DASM"         ] },
  "DUM":        { syntax: [ "MERL"                 ] },
  "DUMMY":      { syntax: [ "MERL"                 ] },
  "DEND":       { syntax: [ "MERL"                 ] },
  "USR":        { syntax: [ "MERL"                 ], create: () => { return new stm.UsrStatement() }},

  "LUP":        { syntax: [ "MERL"                 ] },
  "REPEAT":     { syntax: [         "DASM"         ] },
  "REPEND":     { syntax: [         "DASM"         ] },

  "DB":         { syntax: [ "MERL"                 ], create: () => { return new stm.DataStatement() }},
  "DFB":        { syntax: [ "MERL"                 ], create: () => { return new stm.DataStatement() }},
  "DDB":        { syntax: [ "MERL"                 ], create: () => { return new stm.DataStatement() }},
  "DW":         { syntax: [ "MERL"                 ], create: () => { return new stm.DataStatement() }},
  "DA":         { syntax: [ "MERL",         "LISA" ], create: () => { return new stm.DataStatement() }},
  "DS":         { syntax: [ "MERL", "DASM"         ], create: () => { return new stm.StorageStatement() }},
  "HEX":        { syntax: [ "MERL", "DASM", "LISA" ], create: () => { return new stm.HexStatement() }},
  "DC.B":       { syntax: [         "DASM"         ], create: () => { return new stm.DataStatement() }},
  "DC.W":       { syntax: [         "DASM"         ], create: () => { return new stm.DataStatement() }},
  ".BYTE":      { syntax: [         "DASM"         ], create: () => { return new stm.DataStatement() }},
  ".WORD":      { syntax: [         "DASM"         ], create: () => { return new stm.DataStatement() }},
  "ALIGN":      { syntax: [         "DASM"         ] },
  "ASC":        { syntax: [ "MERL"                 ] },
  "DCI":        { syntax: [ "MERL"                 ] },
  "REV":        { syntax: [ "MERL"                 ] },
  "STR":        { syntax: [ "MERL",         "LISA" ] },

  "DO":         { syntax: [ "MERL"                 ], create: () => { return new stm.ConditionalStatement() }},
  "ELSE":       { syntax: [ "MERL", "DASM"         ], create: () => { return new stm.ConditionalStatement() }},
  "FIN":        { syntax: [ "MERL"                 ], create: () => { return new stm.ConditionalStatement() }},
  "IF":         { syntax: [         "DASM"         ], create: () => { return new stm.ConditionalStatement() }},
  "THEN":       { syntax: [         "DASM"         ] },
  "ELIF":       { syntax: [         "DASM"         ], create: () => { return new stm.ConditionalStatement() }},
  "ENDIF":      { syntax: [         "DASM"         ], create: () => { return new stm.ConditionalStatement() }},

  "TR":         { syntax: [ "MERL"                 ] },
  "LST":        { syntax: [ "MERL",         "LISA" ] },
  "LSTDO":      { syntax: [ "MERL"                 ] },
  "EXP":        { syntax: [ "MERL"                 ] },
  "ON":         { syntax: [ "MERL"                 ] },
  "OFF":        { syntax: [ "MERL"                 ] },
  "PAGE":       { syntax: [ "MERL"                 ] },

  "XC":         { syntax: [ "MERL"                 ] },
  "PROCESSOR":  { syntax: [         "DASM"         ] },
  "SUBROUTINE": { syntax: [         "DASM"         ] },

  "OBJ":        { syntax: [ "MERL",         "LISA" ] },
  "END":        { syntax: [ "MERL",         "LISA" ] },
  "DCM":        { syntax: [                 "LISA" ] },
  "ICL":        { syntax: [                 "LISA" ], create: () => { return new stm.IncludeStatement() }},
  "NLS":        { syntax: [                 "LISA" ] },
  "EPZ":        { syntax: [                 "LISA" ] },
  "ADR":        { syntax: [                 "LISA" ] },

  "ENT":        { syntax: [ "MERL"                 ] },
}


import * as stm from "./x_statements"

// NOTE: ordering must be consistent with Syntax enum in tokenizer.ts

export const Keywords = [
  // UNKNOWN (0)
  {},

  // MERLIN (1)
  {
    "ORG":        {},
    "EQU":        { create: () => { return new stm.EquStatement() }},
    "=":          { create: () => { return new stm.EquStatement() }},
    "ERR":        { create: () => { return new stm.ErrorStatement() }},
    "PUT":        { create: () => { return new stm.IncludeStatement() }},
    "USE":        { create: () => { return new stm.IncludeStatement() }},
    "SAV":        { create: () => { return new stm.SaveStatement() }},
    "DSK":        {},
    "MAC":        {},
    "EOM":        {},
    "DUM":        {},
    "DUMMY":      {},
    "DEND":       {},
    "USR":        { create: () => { return new stm.UsrStatement() }},
    "LUP":        {},
    "DB":         { create: () => { return new stm.DataStatement() }},
    "DFB":        { create: () => { return new stm.DataStatement() }},
    "DDB":        { create: () => { return new stm.DataStatement() }},
    "DW":         { create: () => { return new stm.DataStatement() }},
    "DA":         { create: () => { return new stm.DataStatement() }},
    "DS":         { create: () => { return new stm.StorageStatement() }},
    "HEX":        { create: () => { return new stm.HexStatement() }},
    "ASC":        {},
    "DCI":        {},
    "REV":        {},
    "STR":        {},
    "DO":         { create: () => { return new stm.ConditionalStatement() }},
    "ELSE":       { create: () => { return new stm.ConditionalStatement() }},
    "FIN":        { create: () => { return new stm.ConditionalStatement() }},
    "TR":         {},
    "LST":        {},
    "LSTDO":      {},
    "EXP":        {},
    "ON":         {},
    "OFF":        {},
    "PAGE":       {},
    "XC":         {},
    "OBJ":        {},
    "END":        {},
    "ENT":        { create: () => { return new stm.EntryStatement() }},  
  },

  // DASM (2)
  {
    "ORG":        {},
    "EQU":        { create: () => { return new stm.EquStatement() }},
    "=":          { create: () => { return new stm.EquStatement() }},
    "ERR":        { create: () => { return new stm.ErrorStatement() }},
    "INCLUDE":    { create: () => { return new stm.IncludeStatement() }},
    "MAC":        {},
    "ENDM":       {},
    "SEG":        {},
    "REPEAT":     {},
    "REPEND":     {},
    "DS":         { create: () => { return new stm.StorageStatement() }},
    "HEX":        { create: () => { return new stm.HexStatement() }},
    "DC.B":       { create: () => { return new stm.DataStatement() }},
    "DC.W":       { create: () => { return new stm.DataStatement() }},
    ".BYTE":      { create: () => { return new stm.DataStatement() }},
    ".WORD":      { create: () => { return new stm.DataStatement() }},
    "ALIGN":      {},
    "ELSE":       { create: () => { return new stm.ConditionalStatement() }},
    "IF":         { create: () => { return new stm.ConditionalStatement() }},
    "THEN":       {},
    "ELIF":       { create: () => { return new stm.ConditionalStatement() }},
    "ENDIF":      { create: () => { return new stm.ConditionalStatement() }},
    "PROCESSOR":  {},
    "SUBROUTINE": {},
  },

  // CA65 (3)
  {
  },

  // ACME (4)
  {
  },

  // LISA (5)
  {
    "ORG":        {},
    "EQU":        { create: () => { return new stm.EquStatement() }},
    "=":          { create: () => { return new stm.EquStatement() }},
    "SAV":        { create: () => { return new stm.SaveStatement() }},
    "DA":         { create: () => { return new stm.DataStatement() }},
    "HEX":        { create: () => { return new stm.HexStatement() }},
    "STR":        {},
    "LST":        {},
    "OBJ":        {},
    "END":        {},
    "DCM":        {},
    "ICL":        { create: () => { return new stm.IncludeStatement() }},
    "NLS":        {},
    "EPZ":        {},
    "ADR":        {},
  },

  // SBASM (6)
  {
  }
]

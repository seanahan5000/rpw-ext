
import * as base64 from 'base64-js'
import { SourceFile, Module } from "./project"
import { Statement } from "./statements"

//------------------------------------------------------------------------------

// *** is this still needed? ***

// Convert encode data buffers coming in from breakpoints
//  and stack traces into a utility class object.

export class DataRange {
  public address: number
  public bytes: Uint8Array

  // *** FIX THIS ***
  public static create(obj: any): DataRange | undefined {
    if (obj.dataAddress && obj.dataBytes) {
      return new DataRange(obj.dataAddress, obj.dataBytes)
    }
  }

  constructor(dataAddress: number, dataBytes: string) {
    this.address = dataAddress
    this.bytes = base64.toByteArray(dataBytes)
  }

  public compare(inAddress: number, inBytes: number[] | Uint8Array, inOffset = 0, inCount?: number): number {
    if (inCount === undefined) {
      inCount = inBytes.length
    }
    if (inAddress < this.address) {
      inOffset = this.address - inAddress
      inCount -= inOffset
      inAddress = this.address
    }

    let thisOffset = 0
    if (inAddress > this.address) {
      thisOffset = inAddress - this.address
    }

    const overhang = thisOffset + inCount - this.bytes.length
    if (overhang > 0) {
      inCount -= overhang
    }

    let matches = 0
    for (let i = 0; i < inCount; i += 1) {
      if (inBytes[inOffset + i] == this.bytes[thisOffset + i]) {
        matches += 1
      }
    }
    return matches
  }
}

//------------------------------------------------------------------------------

export type ObjectLine = {
  address?: number
  bytes?: Uint8Array
  statement: Statement // *** needed? ***
}

export type ObjectRange = {
  address: number
  length: number
  objectLines: ObjectLine[]
}

export class ObjectDoc {

  private module: Module
  private sourceFile: SourceFile
  // *** both needed? ***
  private objLines: ObjectLine[] = []
  private objRanges: ObjectRange[] = []

  constructor(module: Module, sourceFile: SourceFile) {
    this.module = module
    this.sourceFile = sourceFile
  }
}

//------------------------------------------------------------------------------

export class ObjectDocBuilder {

  private objectDocs: ObjectDoc[] = []
  private curRange?: ObjectRange

  public buildObjectDocs(module: Module): ObjectDoc[] {
    this.objectDocs = []
    this.curRange = undefined

    for (let line of module.lineRecords) {
      if (!line.bytes) {
        continue
      }
      if (!line.statement || !line.statement.PC) {
        continue
      }
      if (!this.curRange) {
        this.curRange = {
          address: line.statement.PC,
          length: 0,
          objectLines: []
        }
      }
      if (line.statement.PC == this.curRange.address + this.curRange.length) {
        this.curRange.objectLines.push(
          // { address: line.statement.PC, bytes: , }
        )
        this.curRange.length += line.bytes.length
      }
    }

    return this.objectDocs
  }
}

//------------------------------------------------------------------------------

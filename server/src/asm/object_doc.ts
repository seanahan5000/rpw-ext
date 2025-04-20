
import * as base64 from 'base64-js'
import { SourceFile } from "./project"
import { Statement } from "./statements"
import { LineRecord, Segment } from "./assembler"

//------------------------------------------------------------------------------

// Convert encode data buffers coming in from breakpoints
//  and stack traces into a utility class object.

export class DataRange {
  public address: number
  public bytes: Uint8Array

  constructor(dataAddress: number, dataBytes: Uint8Array) {
    this.address = dataAddress
    this.bytes = dataBytes
  }

  public static fromString(dataAddress: number, dataString: string): DataRange {
    return new DataRange(dataAddress, base64.toByteArray(dataString))
  }

  public static fromEntry(obj: any): DataRange | undefined {
    if (obj.dataAddress && obj.dataBytes) {
      return new DataRange(obj.dataAddress, obj.dataBytes)
    }
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

  public get startAddress(): number {
    return this.address
  }

  public get endAddress(): number {
    return this.address + this.bytes.length
  }

  public get dataLength(): number {
    return this.bytes.length
  }
}

//------------------------------------------------------------------------------

class ObjectRange {

  // starting position in source file, zero-based
  public startLine: number = 0

  // empty until after finalize
  private dataRange: DataRange

  // one per source line, plus terminator, relative to dataRange
  private offsets: number[] = [0]

  // used while collecting object data
  public buildSegment?: Segment
  public buildOffset: number

  constructor(startLine: number, segment?: Segment) {
    this.buildSegment = segment
    this.buildOffset = 0
    this.dataRange = new DataRange(segment?.address ?? 0, new Uint8Array(0))
    this.startLine = startLine
  }

  public addLine(byteCount: number, isHidden: boolean) {
    this.buildOffset += byteCount
    if (isHidden) {
      // add to previous offset instead of adding a new one
      this.offsets[this.offsets.length - 1] = this.buildOffset
    } else {
      this.offsets.push(this.buildOffset)
    }
  }

  public finalize() {
    if (this.buildSegment && this.buildOffset > 0) {
      this.buildSegment.finalize()
      const startOffset = this.dataRange.address - this.buildSegment.address
      const subData = this.buildSegment.dataBytes!.subarray(startOffset, startOffset + this.buildOffset)
      this.dataRange = new DataRange(this.dataRange.address, subData)
    }
    this.buildSegment = undefined
    this.buildOffset = 0
  }

  public get endLine(): number {
    return this.startLine + this.offsets.length  - 1
  }

  public get startAddress(): number {
    return this.dataRange.startAddress
  }

  public get dataLength(): number {
    return this.dataRange.dataLength
  }

  public getAddress(lineNumber: number): number {
    return this.dataRange.address + this.offsets[lineNumber]
  }

  public getDataBytes(lineNumber: number): Uint8Array | undefined {
    if (this.offsets.length > 1) {
      const startOffset = this.offsets[lineNumber]
      const endOffset = this.offsets[lineNumber + 1]
      if (startOffset != endOffset) {
        return this.dataRange.bytes.subarray(startOffset, endOffset)
      }
    }
  }

  public matchRange(dataRange: DataRange): number {
    return this.dataRange.compare(dataRange.address, dataRange.bytes)
  }

  public getLine(address: number): number {
    const offset = address - this.startAddress
    let minOffset = 0
    let maxOffset = this.offsets[0]
    for (let i = 1; i < this.offsets.length; i += 1) {
      minOffset = maxOffset
      maxOffset = this.offsets[i]
      if (offset >= minOffset && offset < maxOffset) {
        return i
      }
    }
    throw "ASSERT: ObjectRange.getLine failed"
  }
}

//------------------------------------------------------------------------------

export type RangeMatch = {
  sourceFile: SourceFile
  sourceLine: number
  matchCount: number
}

export type ObjectLine = {
  statement: Statement
  dataAddress?: number
  dataBytes?:Uint8Array
}

// each module has a list of these object files
export class ObjectDoc {

  public sourceFile: SourceFile

  // zero or more ranges of memory covered by file
  private objectRanges: ObjectRange[] = []

  constructor(sourceFile: SourceFile) {
    this.sourceFile = sourceFile
  }

  // called once for every line in source file
  public addLine(line: LineRecord, byteCount: number) {
    let curRange: ObjectRange | undefined
    if (this.objectRanges.length) {
      curRange = this.objectRanges[this.objectRanges.length - 1]
    }
    if (curRange) {
      // check for segment discontinuity
      if (line.statement.segment != curRange.buildSegment) {
        curRange = undefined
      // check for address discontinuity
      } else if (line.statement.PC != curRange.startAddress + curRange.buildOffset) {
        curRange = undefined
        // check for line discontinuity
      } else if (line.lineNumber != curRange.endLine) {
        // TODO: should this be an error instead?
        curRange = undefined
      }
    }
    if (!curRange) {
      curRange = new ObjectRange(line.lineNumber, line.statement.segment)
      this.objectRanges.push(curRange)
    }

    curRange.addLine(byteCount, line.isHidden ?? false)
  }

  public finalize() {
    for (let objRange of this.objectRanges) {
      objRange.finalize()
    }
  }

  // to support converting a PC value to a source file and line
  public findRanges(dataPC: number, dataRange?: DataRange): RangeMatch[] {
    const matches: RangeMatch[] = []
    const dataStart = dataRange ? dataRange.startAddress : dataPC
    const dataEnd = dataRange ? dataRange.endAddress : dataPC + 1
    for (let objRange of this.objectRanges) {
      if (objRange.startAddress + objRange.dataLength <= dataStart) {
        continue
      }
      if (objRange.startAddress >= dataEnd) {
        break
      }
      matches.push({
        sourceFile: this.sourceFile,
        sourceLine: objRange.getLine(dataPC),
        matchCount: dataRange ? objRange.matchRange(dataRange) : 1
      })
    }
    return matches
  }

  public getObjectLines(startLine: number, endLine?: number): ObjectLine[] {
    const result: ObjectLine[] = []

    let lineNum = startLine
    if (endLine === undefined) {
      endLine = startLine + 1
    }

    for (let range of this.objectRanges) {
      if (range.endLine <= lineNum) {
        continue
      }
      if (range.startLine > lineNum) {
        break
      }
      while (lineNum < endLine) {
        const statement = this.sourceFile.statements[lineNum]
        const dataBytes = range.getDataBytes(lineNum)
        const dataAddress = dataBytes ? range.getAddress(lineNum) : undefined
        result.push({ statement, dataAddress, dataBytes })
        if (++lineNum == range.endLine) {
          break
        }
      }
    }

    if (lineNum != endLine) {
      throw "ASSERT: lineNum == endLine failed"
    }
    return result
  }
}

//------------------------------------------------------------------------------


; .defined is a function not a keyword
.if     !.defined( BUILD_ORIGINAL )     ; *** hover over .defined
.endif


.macro .phx arg1,arg2
.endmacro


; .phx 1,2                                 ;*** check arg count?
                .phx 1,2

.struct HullVertex                      ;*** why unreferenced?
        vx              .byte
        vy              .byte
        vz              .byte
.endstruct

                .assert HullVertex::vy = 1, error, "Bad offset"

                .byte HullVertex::vy    ;*** why no hover?


ZP_TEMP_COUNTER1 := $0a
.loop:  lda ZP_TEMP_COUNTER1    ; current point in the circle           ;$8065


.linecont+
.feature labels_without_colons on

; *** test with space after "\" -- should be error (EOL expected)

; *** in elite harmless, why does error count change while clicking through
;   files with errors?

.macro JUNK_BYTE value
		.byte value
.endmacro
; 	JUNK_BYTE {$08,$00,$03,$a5,$00,$00,$04,$a9}

;     .ifblank inverse
;     .else
;     .endif

; .struct HullVertex
;         vx              .byte
;         vy              .byte
;         vz              .byte
;         signs_vis       .byte
;         faces1and2      .byte
;         faces3and4      .byte
; .endstruct


LOAD_BASE       =   $8000
precedence      =   $800-$800+LOAD_BASE ;*** why no hover?
                .if precedence-LOAD_BASE ;*** why no auto-complete suggestion?
                error
                .endif

; *** precedence problem, different from other syntaxes
                ; LDA #>LOAD_BASE+$0100

;===============================================================================

label:
ModuleInit:
ModuleInit2:
ModuleInit3:
ModInit:
ModInit3:
ModuleDone:
ModDone:
IrqHandler:
Handler:
                .feature labels_without_colons on
DrawCircle
DrawRectangle
DrawHexagon

_Clear          .addr   $0D00, $AF13, _Clear
                .align  256
Msg:            .asciiz "Hello world"

                .feature string_escapes+
                .asciiz "X\\X\"X\'X\rX\nX\tX\x1F"

; *** why are escape chars above making these orange? ***
addr            :=  $1000
const           =   99

wait            =   1
                .assert * = $8000, error, "Code not at $8000"
                .assert wait=1, error, "error message"
                .assert wait=1, lderror, "error message"
                .assert wait=1, error
                .assert wait=1, ldwarning, "warning message"
                .assert wait=1, warning, "warning message"
                .assert wait=1, warning

                .autoimport+
                .bss
                .byte "Hello "
                .byt  "world", $0D, $00
                .byte "world", \
                    $0D, $00, <addr
                .case-
                .case+
                .case off
                .case on
                .charmap $41, $61
                .code
                .condes ModuleInit, constructor
                .condes ModuleInit2, constructor, 16
                .condes ModInit, 0, 16
                .constructor ModuleInit3
                .constructor ModInit3, 16
                .destructor ModuleDone
                .destructor ModDone, 16
                .interruptor IrqHandler
                .interruptor Handler, 16

                .data
                .dbyt $1234, $4512
                .debuginfo+
                .debuginfo-
                .debuginfo on
                .debuginfo off

                .define my_def1 11
                .define my_def2 22
                ; .undef my_def1
                ; .undefine my_def2

                .define .nybl1( lower, upper ) \
                    ((upper & 15) << 4 | (lower & 15)) + wait

                .define .nybl2( lower, upper ) ((upper & 15) << 4 | (lower & 15))

                .dword  $12344512, $12FA489

arg2            =   1
                .if 1
                .elseif 2
                .else
                .endif
                .ifdef arg2
                .endif
                .ifndef arg2
                .endif
                ; .ifblank arg2
                ; .endif
                ; .ifnblank arg2
                ; .endif
                ; .ifconst arg2
                ; .endif
                ; .ifref arg2
                ; .endif
                ; .ifnref arg2
                ; .endif

                .enum my_enum
                    ; no_error (implicit numbering)
                    test_error = 100
                .endenum
                ; .word my_enum::no_error
                .word my_enum::test_error

                .macro my_mac1
                .local my_local
                .exitmacro
                .endmacro
                ; .delmacro my_mac1

                .mac .my_mac2 arg1,arg2
                .exitmac
                .endmac
                .my_mac2 1,2
; .my_mac2 3,4
                .delmac my_mac2

                .proc my_proc
                .endproc

.proc   hull_escape
        .proc   header
        debris          = 0
        .endproc
        .proc   header2
        debris          = 1
        .endproc
.endproc

.proc   hull_escape2
        .proc   header
        debris          = 0
        .endproc
        .proc   header2
        debris          = 1
        .endproc
.endproc

                .repeat wait+2,var
                .byte var
                .endrep
                .repeat 3
                .endrepeat
                .scope my_scope
                    no_error=1
                .endscope
                .word my_scope::no_error
                .struct my_struct
                .endstruct
                .union my_union
                .endunion

.ifndef BUILD
                .error "eror message"
                .warning "warning message"
                .fatal "fatal message"
                .out "output message"
.endif

my_export1
my_export2
my_export3      =   99
my_export4
my_export5      =   $00
                .export my_export1
                .export my_export3:direct
                .export my_export4:absolute
                .export my_export5:zeropage
                .import my_import6
                .import my_import7:direct
                .import my_import8:absolute
                .import my_import9:zeropage
                .import my_import9:zeropage

foo1            := $1000
bar1            := $2000
fooZ            := $10
barZ            := $20
                .export foo1, bar1
                ; .export foobar: far = foo * bar
                ; .export baz := foobar, zap: far = baz - bar
                .exportzp fooZ, barZ
                ; .exportzp baz := $02
                .import foo2
                .import bar2: zeropage
                .importzp foo3, bar3
                .importzp foo3
                .forceimport needthisone, needthistoo

                .faraddr DrawCircle, DrawRectangle, DrawHexagon

                ; NOTE: only allowed in ca65 V2.19 or greater
                .feature c_comments
                .feature c_comments +
                .feature force_range, underline_in_numbers -, labels_without_colons +
                .feature force_range +, underline_in_numbers off, labels_without_colons on

                .feature at_in_identifiers
                .feature bracket_as_indirect
                .feature c_comments
                .feature dollar_in_identifiers
                .feature dollar_is_pc
                .feature force_range
                .feature labels_without_colons
                .feature leading_dot_in_identifiers
                .feature loose_char_term
                .feature loose_string_term
                .feature missing_char_term
                .feature org_per_seg
                .feature pc_assignment
                .feature string_escapes
                .feature ubiquitous_idents
                .feature underline_in_numbers
                .feature line_continuations
                .linecont+

                .fileopt comment, "Comment text"
                .fileopt compiler, "CA65"
                .fopt author, "Your name here"

fooG            := $10
barG            := $20
                .global fooG, barG
                .globalzp fooG, barG

                .lobytes $1234, $2345, $3456, $4567
                .hibytes $fedc, $edcb, $dcba, $cba9
                .bankbytes $100000

.ifndef BUILD
                .incbin "sprites.dat"
                .incbin "music.dat", $100
                .incbin "graphics.dat", 200, 100
.endif
                .include "pass.inc"
                .list on
                .listbytes unlimited
                .listbytes 12
                .literal "Hello "
                .literal "world", $0D, $00
                .lobytes $1234, $2345, $3456, $4567
                .hibytes $fedc, $edcb, $dcba, $cba9
                .localchar '?'
.ifndef BUILD
                .macpack atari
                .macpack cbm
                .macpack cpu
                .macpack generic
                .macpack longbranch
.endif
                .org $7ff
                .pagelength 66
                .pagelength unlimited
                .pushcharmap
                .popcharmap
                .pushcpu
                .popcpu
                .pushseg
                .popseg
                .referto label
                .refto label
                .reloc
                .repeat 99, I
                .byte I
                .endrep
                .res 12, $AA
                .res 12
                .rodata
                .segment "ROM2"
                .segment "ZP2": zeropage
                .segment "ZP2"
                .segment "ZP3": absolute
                .setcpu "6502"
                .setcpu "65c02"
four            .set 4
four            .set 3
                .smart
                .smart -
                .smart +
                .smart on
                .smart off
                .tag my_struct
                .word $0D00, $AF13, _Clear
                .zeropage

                ; 65816-only features

                .setcpu "65816"
                .feature long_jsr_jmp_rts
                .export my_export2:far
                .import my_import2:far
                .export bar1: far

                .end

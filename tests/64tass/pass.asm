
        .weak
BUILD = 0
        .endweak

; my_macro2       .macro param
;                 lda #\param
;                 .endmacro

; my_union        .union param            ;*** scope to my_union
; ; x               .byte ?
; y               .word \1
; zz              .word \param
;                 .endunion
; i_union         .dunion my_union,1

; my_struct       .struct col,row=3
; x               .byte \col
; y               .byte \row
;                 .endstruct
; ; ; i_struct        .dstruct my_struct,1,2

;                 lda #my_struct.y
;                 ; lda #my_union.zz

;                 .cerror my_struct.y != 1, "Bad struct offset != ", my_struct.y

; DECRUNCH_FORWARDS := 1
; DECRUNCH_FORWARDS :?= 0

;         .WORD (+), 2022                 ;pointer, line number
;         .NULL $9E, FORMAT("%4d", start) ;will be "sys ${start}"
; +       .WORD 0                         ;basic line end

        ; .for step := $0000, step < $0400, step += $0100
        ; lda image_color + step,x
        ; sta $d800 + step,x
        ; .endfor

; _LIST0 = [$A188,$A1A7,$A169,$A261,$A2FC,$A2DD,$A2BE,$A31B]      ;0-7
; _LIST1 = [$A280,$A33A,$A359,$A378,$A397,$A3B6,$A3D5,$A3F4]      ;8-15
; _LIST2 = [$A413,$A432,$9E2F,$9E2F,$9E2F,$A1C6,$A1E5,$A204]      ;15-23
; _LIST_ALL= _LIST0 .. _LIST1 .. _LIST2

; _L01    JSR _L03
; a0827   .BYTE $00
; _L03    LDA a0966

; planetSurfaceData = $1000
        ; CMP (#>planetSurfaceData) + $10


                .cpu "65c02"
                .cpu "65816"
                .cpu "default"
                .cpu "6502"

* = $1000
                *=$2000

                .offs $100
                .logical $3000
                .endlogical
                .logical $3000
                .here

                .virtual $4000
                .endvirtual
                .virtual
                .endv

                .page
                .endpage
                .page 256
                .endp
                .page 256,128
                .endpage

                .align
                .align $400
                .align $400,$20
                .align $400,$20,-8
                .align $400,?,-8

                .alignblk
                .endalignblk
                .alignblk $100
                .endalignblk
                .alignblk $100,$ee
                .endalignblk
                .alignblk $100,$ee,-8
                .endalignblk

                .alignpageind pageblk1
                .alignpageind pageblk1,$100
                .alignpageind pageblk1,$100,$ee
                .alignpageind pageblk1,$100,$ee,-8
pageblk1
                .alignpageind pageblk2
                .alignpageind pageblk2,$100
                .alignpageind pageblk2,$100,$ee
                .alignpageind pageblk2,$100,$ee,-8
pageblk2

                .byte 0,$ff
                .char -128,127
                .word 0,$ffff
                .sint -32768,32767
                .addr pageblk1,pageblk2,$ffff
                .rta pageblk1,pageblk2,$ffff
                .long 0,$ffffff
                .lint -$800000,$7fffff
                .dword 0,$ffffffff
                .dint -$80000000,$7fffffff

                .fill $100
                .fill $100,$ee
                ; .fill $100,[$ee]
                ; .fill $100,[$ee,$ff]

                .text "abc",$0a0d
                .text 'xyz',%00111111
                .text "\r"              ; escapes not supported -- just a string

                .shift "abc",32,"xyz"
                .shiftl "abc",32,"xyz"
                .null "abc",32,"xyz"
                .ptext "abc",32,"xyz"

                .enc "screen"
                .enc "none"
                .enc "custom"
vt100           .encode
                .cdef " ~",32
                .edef "{esc}",27
.if BUILD==0
                ; .edef "{moff}", [27, "[", "m"]
                ; .edef "{bold}", [27, "[", "1", "m"]
                ; .tdef "A",65
                .tdef "ACX",65
                ; .tdef "ACX",[65, 33, 11]
.endif
                .endencode
                .encode vt100
                .endencode

                .struct
zz              .byte 0
                .endstruct
my_struct       .struct col,row=3
x               .byte \col
zz              .byte \row
                .ends
i_struct        .dstruct my_struct,1,2

                .union
zz              .byte 0
                .endunion

my_union        .union param
xx              .byte ?
yy              .word \1
zz              .word \param
                .endu
i_union         .dunion my_union,1

my_macro1       .macro
                .endm

                #my_macro1 "test"
#my_macro1 "test"

my_macro2       .macro first,b=2,,last
                lda #\first
                lda #\b
                lda #\3
                lda #\last
                .endmacro

                #my_macro2 1,,3,4

my_segment1     .segment
                .endsegment

my_segment2     .segment
                .endm result1,result2

my_sfunction    .sfunction _font,_scr=0, ((_font >> 10) & $0f) | ((_scr >> 6) & $f0)

                lda #my_sfunction($2000,$0400)

my_function     .function value,target
                lda value
                sta target
                .endfunction

label
                my_function #1,label

wait            = 2
.if wait==2
                nop
.elsif wait==3
                bit $ea
.elsif wait==4
                bit $eaea
.else
                inc $2
.endif
                .ifne wait
                .endif
                .ifeq wait
                .endif
                .ifpl wait
                .endif
                .ifmi wait
                .fi

                .switch wait
                .case 2
                .case 3
                .default
                .endswitch

.comment
; This is a comment
.endcomment
.comment
; This is another comment
.endc

lp .for ue := $400, ue < $800, ue += $100
                sta ue,x
.endfor
; .for col in 0, 11, 12, 15, 1
;                 lda #col
; .endfor
.rept 100
.endrept

                .while wait
                .breakif wait
                .break
                .continue
                .continueif wait
                .endwhile

                .bwhile wait
                .break
                .next

i               .var 100
; loop           .lbl
                nop
i               .var i - 1
                .ifne i
;               .goto loop
                .endif

                .include "pass.inc"
.if BUILD==0
                .binclude "file.a"
                .binary "file.bin"
                .binary "file.bin", 2
                .binary "file.bin", 2, 1000
.endif

name            .proc
                .endproc
                .block
                .endblock
                .block
                .bend

                .namespace name         ;space
                .endnamespace
                .namespace
                .endn
                .weak
                .endweak
                .with name              ;something
                .endwith

                * = $00
                .dsection zp_section
                * = $1000
                .dsection my_section1
                * = $2000
                .dsection my_section2

                .section my_section1
                .endsection my_section1
                .section my_section2
                .send

                .option allow_branch_across_page = 0

.if BUILD==0
                .error "Unfinished here..."
                .cerror * > $1200, "Program too long by ", * - $1200, " bytes"
                .warn "FIXME: handle negative values too!"
                .cwarn * > $1200, "This may not work!"
.endif

                .eor $ff
                .seed $7f
counter         .var 0
red             .from vic.colors

                .proff
                .pron

.end
; This is ignored

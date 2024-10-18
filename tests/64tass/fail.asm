                .cpu                    ; target missing
                .cpu 6502               ; quotes required
                .cpu "bad"              ; *** no match
                *=                      ; missing assignment
                .offs                   ; missing expression
                .logical                ; missing expression
                .virtual $4000,$1000    ; too many expressions
                .endvirtual $1000       ; too many expressions
                .page 256,128,99        ; too many expressions
                .align 1,2,3,4          ; too many expressions
                .alignblk 1,2,3,4       ; too many expressions
                .alignpageind           ; missing expression
                .alignpageind 1,2,3,4,5 ; too many expressions
                .fill                   ; missing expression
                .fill $100,             ; missing expression
                .fill $100,$ee,00       ; too many expressions
                .byte                   ; missing expressions
                .byte -1                ; out of range
                .byte 256               ; out of range
                .char                   ; missing expressions
                .char -129              ; out of range
                .char 128               ; out of range
                .word                   ; missing expression
                .word -1                ; out of range
                .word 65536             ; out of range
                .sint                   ; missing expression
                .sint -32769            ; out of range
                .sint 32768             ; out of range
                .addr                   ; missing expression
                .addr -1                ; out of range
                .addr $1FFFF            ; out of range
                .rta                    ; missing expression
                .rta -1                 ; *** out of range
                .rta $1FFFF             ; out of range
                .long                   ; missing expression
                .long -1                ; out of range
                .long $1000000          ; out of range
                .lint                   ; missing expression
                .lint -$800001          ; out of range
                .lint $800000           ; out of range
                .dword                  ; missing expression
                .dword -1               ; out of range
                .dword $100000000       ; out of range
                .dint                   ; missing expression
                .dint -$80000001        ; out of range
                .dint $80000000         ; out of range

; ; TODO: more fail cases here

                .text "\""              ; escapes not supported

                .proc                   ; label required

                .dsection zp_section
                .dsection zp_section    ; duplicate section

#!/bin/sh
# usage: sign.sh <binary>
codesign --force -s "${SIGN_ID:?SIGN_ID に署名の identity の hash を入れる}" -i com.momo.securityd "$1"

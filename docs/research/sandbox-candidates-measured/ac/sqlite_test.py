"""Concurrent SQLite / JSONL access across the host and the guest through a shared dir.

usage: sqlite_test.py init <db> <wal|delete>
       sqlite_test.py incr <db> <wal|delete> <n> <who>      # read-modify-write n times
       sqlite_test.py append <db> <wal|delete> <n> <who> <interval_s>
       sqlite_test.py poll <db> <wal|delete> <seconds> <who>  # report rows seen from the other side
       sqlite_test.py check <db>
       sqlite_test.py jsonl-append <file> <n> <who> <interval_s>
       sqlite_test.py jsonl-poll <file> <seconds> <who>
       sqlite_test.py jsonl-check <file>
Prints one JSON object per line.
"""
import json
import os
import sqlite3
import sys
import time


def out(**kw):
    print(json.dumps(kw), flush=True)


def connect(db, mode):
    c = sqlite3.connect(db, timeout=10, isolation_level=None)
    got = c.execute(f"PRAGMA journal_mode={mode}").fetchone()[0]
    c.execute("PRAGMA busy_timeout=10000")
    return c, got


def init(db, mode):
    c, got = connect(db, mode)
    c.execute("CREATE TABLE IF NOT EXISTS counter(id INTEGER PRIMARY KEY, v INTEGER)")
    c.execute("INSERT OR IGNORE INTO counter VALUES(1, 0)")
    c.execute("CREATE TABLE IF NOT EXISTS log(seq INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT, n INTEGER, ts REAL)")
    out(op="init", journal_mode=got)


def incr(db, mode, n, who):
    c, got = connect(db, mode)
    busy = 0
    other = 0
    t0 = time.time()
    done = 0
    while done < n:
        try:
            c.execute("BEGIN IMMEDIATE")
            v = c.execute("SELECT v FROM counter WHERE id=1").fetchone()[0]
            c.execute("UPDATE counter SET v=? WHERE id=1", (v + 1,))
            c.execute("COMMIT")
            done += 1
        except sqlite3.OperationalError as e:
            if "locked" in str(e) or "busy" in str(e):
                busy += 1
            else:
                other += 1
                out(op="incr.error", who=who, error=str(e))
            try:
                c.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            if other > 20:
                break
    out(op="incr", who=who, journal_mode=got, done=done, busy=busy, other_errors=other, secs=round(time.time() - t0, 2))


def incrfor(db, mode, secs, who, outfile):
    c, got = connect(db, mode)
    busy = other = done = 0
    errors = []
    end = time.time() + secs
    while time.time() < end:
        try:
            c.execute("BEGIN IMMEDIATE")
            v = c.execute("SELECT v FROM counter WHERE id=1").fetchone()[0]
            c.execute("UPDATE counter SET v=? WHERE id=1", (v + 1,))
            c.execute("COMMIT")
            done += 1
        except sqlite3.Error as e:
            if "locked" in str(e) or "busy" in str(e):
                busy += 1
            else:
                other += 1
                if len(errors) < 3:
                    errors.append(str(e))
            try:
                c.execute("ROLLBACK")
            except sqlite3.Error:
                pass
        if outfile and done % 200 == 0:
            with open(outfile, "w") as f:
                f.write(json.dumps({"done": done, "partial": True}))
    r = dict(op="incrfor", who=who, journal_mode=got, done=done, busy=busy, other_errors=other, errors=errors)
    if outfile:
        with open(outfile, "w") as f:
            f.write(json.dumps(r))
    out(**r)


def append(db, mode, n, who, interval):
    c, got = connect(db, mode)
    errs = 0
    for i in range(n):
        try:
            c.execute("INSERT INTO log(who, n, ts) VALUES(?,?,?)", (who, i, time.time()))
        except sqlite3.Error as e:
            errs += 1
            out(op="append.error", who=who, error=str(e))
        time.sleep(interval)
    out(op="append", who=who, journal_mode=got, n=n, errors=errs)


def poll(db, mode, seconds, who):
    c, got = connect(db, mode)
    end = time.time() + seconds
    last = 0
    seen = 0
    lags = []
    errs = 0
    while time.time() < end:
        try:
            rows = c.execute("SELECT seq, who, ts FROM log WHERE seq>? AND who<>?", (last, who)).fetchall()
            now = time.time()
            for seq, w, ts in rows:
                seen += 1
                lags.append(now - ts)
                last = max(last, seq)
        except sqlite3.Error as e:
            errs += 1
            if errs < 5:
                out(op="poll.error", who=who, error=str(e))
        time.sleep(0.1)
    lags.sort()
    med = lags[len(lags) // 2] if lags else None
    out(op="poll", who=who, journal_mode=got, seen=seen, errors=errs,
        lag_median_s=round(med, 3) if med is not None else None,
        lag_max_s=round(lags[-1], 3) if lags else None)


def pollre(db, seconds, who):
    """Like poll, but opens a fresh read-only connection for every poll."""
    end = time.time() + seconds
    last = seen = errs = 0
    lags = []
    while time.time() < end:
        try:
            c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)
            rows = c.execute("SELECT seq, who, ts FROM log WHERE seq>? AND who<>?", (last, who)).fetchall()
            c.close()
            now = time.time()
            for seq, w, ts in rows:
                seen += 1
                lags.append(now - ts)
                last = max(last, seq)
        except sqlite3.Error as e:
            errs += 1
            if errs < 5:
                out(op="pollre.error", who=who, error=str(e))
        time.sleep(0.1)
    lags.sort()
    out(op="pollre", who=who, seen=seen, errors=errs,
        lag_median_s=round(lags[len(lags) // 2], 3) if lags else None,
        lag_max_s=round(lags[-1], 3) if lags else None)


def check(db):
    c = sqlite3.connect(db, timeout=10)
    try:
        ic = c.execute("PRAGMA integrity_check").fetchall()
        v = c.execute("SELECT v FROM counter WHERE id=1").fetchone()
        n = c.execute("SELECT count(*) FROM log").fetchone()
        jm = c.execute("PRAGMA journal_mode").fetchone()[0]
        out(op="check", integrity=[r[0] for r in ic][:5], counter=v and v[0], log_rows=n and n[0], journal_mode=jm)
    except sqlite3.Error as e:
        out(op="check", error=str(e))


def jsonl_append(path, n, who, interval):
    with open(path, "a") as f:
        for i in range(n):
            f.write(json.dumps({"who": who, "n": i, "ts": time.time()}) + "\n")
            f.flush()
            time.sleep(interval)
    out(op="jsonl-append", who=who, n=n)


def jsonl_poll(path, seconds, who):
    end = time.time() + seconds
    pos = 0
    buf = ""
    seen = 0
    torn = 0
    lags = []
    while time.time() < end:
        try:
            with open(path) as f:
                f.seek(pos)
                chunk = f.read()
                pos = f.tell()
        except FileNotFoundError:
            chunk = ""
        buf += chunk
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            try:
                o = json.loads(line)
            except ValueError:
                torn += 1
                continue
            if o["who"] != who:
                seen += 1
                lags.append(time.time() - o["ts"])
        time.sleep(0.1)
    lags.sort()
    out(op="jsonl-poll", who=who, seen=seen, torn=torn,
        lag_median_s=round(lags[len(lags) // 2], 3) if lags else None,
        lag_max_s=round(lags[-1], 3) if lags else None)


def jsonl_check(path):
    good = bad = 0
    with open(path) as f:
        for line in f:
            try:
                json.loads(line)
                good += 1
            except ValueError:
                bad += 1
    out(op="jsonl-check", good=good, bad=bad)


def main():
    a = sys.argv[1:]
    op = a[0]
    if op == "init":
        init(a[1], a[2])
    elif op == "incr":
        incr(a[1], a[2], int(a[3]), a[4])
    elif op == "incrfor":
        incrfor(a[1], a[2], float(a[3]), a[4], a[5] if len(a) > 5 else "")
    elif op == "append":
        append(a[1], a[2], int(a[3]), a[4], float(a[5]))
    elif op == "poll":
        poll(a[1], a[2], float(a[3]), a[4])
    elif op == "pollre":
        pollre(a[1], float(a[2]), a[3])
    elif op == "check":
        check(a[1])
    elif op == "jsonl-append":
        jsonl_append(a[1], int(a[2]), a[3], float(a[4]))
    elif op == "jsonl-poll":
        jsonl_poll(a[1], float(a[2]), a[3])
    elif op == "jsonl-check":
        jsonl_check(a[1])
    else:
        sys.exit(f"unknown op {op}")


if __name__ == "__main__":
    main()

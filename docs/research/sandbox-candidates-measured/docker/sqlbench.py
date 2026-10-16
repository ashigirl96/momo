"""Concurrent SQLite access across the host/VM file share.

usage: sqlbench.py write <who> <journal_mode> <db> <n>    increments a shared counter and appends rows
       sqlbench.py poll  <who> <journal_mode> <db> <secs>  polls rows written by others, reports visibility lag
       sqlbench.py loop  <who> <journal_mode> <db>         writes forever (for kill -9 tests)
       sqlbench.py check <db>                               integrity_check and counter vs rows
       sqlbench.py jsonl-write <who> <file> <n> / jsonl-read <who> <file> <secs>
"""
import json, os, sqlite3, sys, time


def open_db(mode, path):
    con = sqlite3.connect(path, timeout=5, isolation_level=None)
    got = con.execute(f"PRAGMA journal_mode={mode}").fetchone()[0]
    con.execute("PRAGMA busy_timeout=5000")
    con.execute("CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, who TEXT, ts REAL)")
    con.execute("CREATE TABLE IF NOT EXISTS c(k TEXT PRIMARY KEY, n INTEGER)")
    con.execute("INSERT OR IGNORE INTO c VALUES('x', 0)")
    return con, got


def open_retry(mode, path):
    for attempt in range(50):
        try:
            con, got = open_db(mode, path)
            return con, got, attempt
        except sqlite3.OperationalError as e:
            last = e
            time.sleep(0.1)
    raise last


def write(who, mode, path, n, forever=False):
    con, got, open_retries = open_retry(mode, path)
    ok = busy = other = 0
    t0 = time.time()
    i = 0
    while forever or i < n:
        i += 1
        try:
            con.execute("BEGIN IMMEDIATE")
            cur = con.execute("SELECT n FROM c WHERE k='x'").fetchone()[0]
            con.execute("UPDATE c SET n=? WHERE k='x'", (cur + 1,))
            con.execute("INSERT INTO t(who, ts) VALUES(?, ?)", (who, time.time()))
            con.execute("COMMIT")
            ok += 1
        except sqlite3.OperationalError as e:
            if "locked" in str(e) or "busy" in str(e):
                busy += 1
            else:
                other += 1
                if other <= 3:
                    print(json.dumps({"who": who, "error": str(e)}), flush=True)
            try:
                con.execute("ROLLBACK")
            except sqlite3.OperationalError:
                pass
    print(json.dumps({"who": who, "mode": got, "open_retries": open_retries, "ok": ok, "busy": busy, "other_err": other,
                      "secs": round(time.time() - t0, 2)}), flush=True)


def poll(who, mode, path, secs):
    con, got = open_db(mode, path)
    seen, lags, last = 0, [], 0
    end = time.time() + secs
    while time.time() < end:
        rows = con.execute("SELECT id, ts FROM t WHERE id > ? AND who != ?", (last, who)).fetchall()
        now = time.time()
        for rid, ts in rows:
            lags.append(now - ts)
            last = max(last, rid)
        seen += len(rows)
        time.sleep(0.01)
    lags.sort()
    pct = lambda p: round(lags[int(p * (len(lags) - 1))] * 1000, 1) if lags else None
    print(json.dumps({"who": who, "mode": got, "seen": seen, "lag_ms_p50": pct(0.5), "lag_ms_p99": pct(0.99),
                      "lag_ms_max": pct(1.0)}), flush=True)


def check(path):
    con = sqlite3.connect(path, timeout=5)
    ic = con.execute("PRAGMA integrity_check").fetchall()
    rows = con.execute("SELECT count(*) FROM t").fetchone()[0]
    n = con.execute("SELECT n FROM c WHERE k='x'").fetchone()[0]
    mode = con.execute("PRAGMA journal_mode").fetchone()[0]
    print(json.dumps({"integrity": [r[0] for r in ic][:5], "rows": rows, "counter": n,
                      "lost_updates": rows - n, "mode": mode}), flush=True)


def jsonl_write(who, path, n):
    with open(path, "a") as f:
        for i in range(n):
            f.write(json.dumps({"who": who, "i": i, "ts": time.time(), "pad": "x" * 200}) + "\n")
            f.flush()
            time.sleep(0.002)


def jsonl_read(who, path, secs):
    seen = bad = 0
    lags = []
    pos = 0
    buf = ""
    end = time.time() + secs
    while time.time() < end:
        with open(path) as f:
            f.seek(pos)
            chunk = f.read()
            pos = f.tell()
        buf += chunk
        *lines, buf = buf.split("\n")
        now = time.time()
        for line in lines:
            try:
                o = json.loads(line)
            except ValueError:
                bad += 1
                continue
            if o["who"] != who:
                seen += 1
                lags.append(now - o["ts"])
        time.sleep(0.01)
    lags.sort()
    print(json.dumps({"who": who, "seen": seen, "bad_lines": bad, "partial_tail": len(buf),
                      "lag_ms_p50": round(lags[len(lags) // 2] * 1000, 1) if lags else None,
                      "lag_ms_max": round(lags[-1] * 1000, 1) if lags else None}), flush=True)


if __name__ == "__main__" and sys.argv[1] not in ("oneway-write", "oneway-read"):
    a = sys.argv
    {"write": lambda: write(a[2], a[3], a[4], int(a[5])),
     "loop": lambda: write(a[2], a[3], a[4], 0, forever=True),
     "poll": lambda: poll(a[2], a[3], a[4], float(a[5])),
     "check": lambda: check(a[2]),
     "jsonl-write": lambda: jsonl_write(a[2], a[3], int(a[4])),
     "jsonl-read": lambda: jsonl_read(a[2], a[3], float(a[4]))}[a[1]]()


def oneway_write(who, mode, path, n, openclose):
    """Single writer per file, as NanoClaw's inbound.db/outbound.db; optionally open-write-close per message."""
    con = None
    errs = 0
    if not openclose:
        con, _ = open_db(mode, path)
    for i in range(n):
        try:
            if openclose:
                con, _ = open_db(mode, path)
            con.execute("INSERT INTO t(who, ts) VALUES(?, ?)", (who, time.time()))
            if openclose:
                con.close()
        except sqlite3.Error as e:
            errs += 1
            if errs <= 3:
                print(json.dumps({"who": who, "error": str(e)}), flush=True)
        time.sleep(0.005)
    print(json.dumps({"who": who, "wrote": n, "errors": errs}), flush=True)


def oneway_read(who, path, secs, openclose):
    uri = f"file:{path}?mode=ro"
    con = None if openclose else sqlite3.connect(uri, uri=True, timeout=5)
    last, seen, errs, lags = 0, 0, 0, []
    end = time.time() + secs
    while time.time() < end:
        try:
            c = sqlite3.connect(uri, uri=True, timeout=5) if openclose else con
            c.execute("PRAGMA busy_timeout=2000")
            rows = c.execute("SELECT id, ts FROM t WHERE id > ? AND who != ?", (last, who)).fetchall()
            if openclose:
                c.close()
            now = time.time()
            for rid, ts in rows:
                lags.append(now - ts)
                last = max(last, rid)
            seen += len(rows)
        except sqlite3.Error as e:
            errs += 1
            if errs <= 3:
                print(json.dumps({"who": who, "read_error": str(e)}), flush=True)
        time.sleep(0.01)
    lags.sort()
    pct = lambda p: round(lags[int(p * (len(lags) - 1))] * 1000, 1) if lags else None
    print(json.dumps({"who": who, "openclose": openclose, "seen": seen, "max_id": last, "errors": errs,
                      "lag_ms_p50": pct(0.5), "lag_ms_p99": pct(0.99), "lag_ms_max": pct(1.0)}), flush=True)


if __name__ == "__main__" and sys.argv[1] in ("oneway-write", "oneway-read"):
    a = sys.argv
    if a[1] == "oneway-write":
        oneway_write(a[2], a[3], a[4], int(a[5]), a[6] == "1")
    else:
        oneway_read(a[2], a[3], float(a[4]), a[5] == "1")

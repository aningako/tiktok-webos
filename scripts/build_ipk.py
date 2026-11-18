#!/usr/bin/env python3
"""Build the webOS IPK without the webOS CLI (same layout as `ares-package`).

Usage: python3 scripts/build_ipk.py            -> releases/<id>_<version>_all.ipk
"""
import io, json, os, sys, tarfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, 'app', 'com.homebrew.tiktok')
OUT_DIR = os.path.join(ROOT, 'releases')
NOW = int(time.time())


def tar_gz(entries):
    """entries: list of (arcname, bytes|None for dir, mode)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.GNU_FORMAT) as tf:
        for name, data, mode in entries:
            ti = tarfile.TarInfo(name)
            ti.mtime, ti.mode, ti.uid, ti.gid = NOW, mode, 0, 0
            if data is None:
                ti.type = tarfile.DIRTYPE
                tf.addfile(ti)
            else:
                ti.size = len(data)
                tf.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


def ar(members):
    out = [b'!<arch>\n']
    for name, data in members:
        hdr = '%-16s%-12d%-6d%-6d%-8s%-10d`\n' % (name, NOW, 0, 0, '100644', len(data))
        out.append(hdr.encode('ascii'))
        out.append(data)
        if len(data) % 2:
            out.append(b'\n')
    return b''.join(out)


def main():
    info = json.load(open(os.path.join(APP_DIR, 'appinfo.json')))
    app_id, version = info['id'], info['version']
    app_base = 'usr/palm/applications/' + app_id
    pkg_base = 'usr/palm/packages/' + app_id

    dirs = ['usr', 'usr/palm', 'usr/palm/applications', 'usr/palm/packages', app_base, pkg_base]
    files, size = [], 0
    for dp, dns, fns in os.walk(APP_DIR):
        dns.sort()
        rel = os.path.relpath(dp, APP_DIR)
        if rel != '.':
            dirs.append(app_base + '/' + rel.replace(os.sep, '/'))
        for fn in sorted(fns):
            data = open(os.path.join(dp, fn), 'rb').read()
            arc = app_base + '/' + (fn if rel == '.' else rel.replace(os.sep, '/') + '/' + fn)
            files.append((arc, data, 0o644))
            size += len(data)

    pkginfo = json.dumps({'id': app_id, 'version': version, 'app': app_id}, indent=2).encode()
    files.append((pkg_base + '/packageinfo.json', pkginfo, 0o644))

    data_tgz = tar_gz([(d, None, 0o755) for d in dirs] + files)
    control = ('Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\n'
               'Installed-Size: %d\nMaintainer: aning <aningako@users.noreply.github.com>\n'
               'Description: Unofficial TikTok for LG webOS. Created by aning with the help of Claude (Anthropic).\nwebOS-Package-Format-Version: 2\n'
               'webOS-Packager-Version: x.y.x\n') % (app_id, version, size)
    control_tgz = tar_gz([('control', control.encode(), 0o644)])

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, '%s_%s_all.ipk' % (app_id, version))
    with open(out, 'wb') as f:
        f.write(ar([('debian-binary', b'2.0\n'), ('control.tar.gz', control_tgz), ('data.tar.gz', data_tgz)]))
    print(out)


if __name__ == '__main__':
    sys.exit(main())

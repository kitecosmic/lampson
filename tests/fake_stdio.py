"""tests/fake_stdio.py: the smallest `lampson run --stdio`: says ready and closes when stdin closes (sdk_test.py,
to check that a relative local['command'] is the app's path, not the workspace's)."""
import sys
print('{"kind": "ready", "data": {"argv": %d}}' % len(sys.argv), flush=True)
for _ in sys.stdin:
    pass

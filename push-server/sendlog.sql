SELECT datetime(due_at/1000,'unixepoch','+3 hours') AS due_riyadh, datetime(sent_at/1000,'unixepoch','+3 hours') AS sent_riyadh,
       (sent_at - due_at)/1000 AS delay_s, sub, tag, status, reason
FROM sendlog ORDER BY sent_at DESC LIMIT 40;

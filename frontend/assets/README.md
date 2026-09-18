# Assets

Employee profile photos and the company logo go here. The frontend falls back
to generated initials when `photo_url` is empty, so the system works before any
image is uploaded.

Keep uploaded photos out of version control; serve them from the same reverse
proxy as the frontend, or from object storage, and store only the URL in the
`employees.photo_url` column.

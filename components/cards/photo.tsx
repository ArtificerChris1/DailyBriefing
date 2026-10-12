"use client";

import { Camera } from "lucide-react";
import Image from "next/image";

import { Card, ExternalLink } from "@/components/ui";
import type { PhotoMemory, PhotoOfDay } from "@/lib/briefing-types";
import { plural } from "@/lib/format";

/** Today's photo from the shared album, and photos from this date in earlier years. */
export function PhotoCard({
  photo,
  photoUrl,
  memories,
  memoryUrls,
  timeZone,
}: {
  photo?: PhotoOfDay;
  photoUrl?: string;
  memories?: PhotoMemory[];
  memoryUrls: (string | undefined)[];
  timeZone: string;
}) {
  const takenOn = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone,
    }).format(Date.parse(iso));
  const album = photo?.albumName ?? "the shared album";

  return (
    <Card
      title="Photo of the day"
      icon={Camera}
      className="photo-card"
      meta={photo?.albumName}
      actions={
        photo?.albumUrl ? (
          <ExternalLink href={photo.albumUrl} label={`Open ${album}`} className="text-link">
            Open album
          </ExternalLink>
        ) : undefined
      }
    >
      {photo && photoUrl && (
        <figure className="photo">
          <Image
            src={photoUrl}
            alt={
              photo.caption
                ? photo.caption
                : `Photo from ${album}${photo.takenAt ? `, taken ${takenOn(photo.takenAt)}` : ""}`
            }
            width={photo.width}
            height={photo.height}
            unoptimized
          />
          {(photo.caption || photo.takenAt) && (
            <figcaption>
              {photo.caption && <span className="photo-caption">{photo.caption}</span>}
              {photo.takenAt && <span className="photo-date">{takenOn(photo.takenAt)}</span>}
            </figcaption>
          )}
        </figure>
      )}
      {memories && memoryUrls.some(Boolean) && (
        <div className="memories">
          <h3 className="list-group-title">On this day</h3>
          <ul>
            {memories.map((memory, index) =>
              memoryUrls[index] ? (
                <li key={memory.src}>
                  <Image
                    src={memoryUrls[index]!}
                    alt={`Photo from ${album}, taken ${takenOn(memory.takenAt)}`}
                    width={memory.width}
                    height={memory.height}
                    unoptimized
                  />
                  <span>{plural(memory.yearsAgo, "year")} ago</span>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}

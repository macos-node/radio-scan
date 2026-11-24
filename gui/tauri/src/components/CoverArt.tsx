import { useEffect, useState } from "react";
import { podcastArtCache } from "../lib/art";
import type { MediaIconKey } from "../lib/mediaIcon";
import { MediaGlyph } from "./MediaGlyph";

/** A square artwork slot: the show's cached cover art when it has one, the
 *  category glyph otherwise (and while the art is still loading). */
export function CoverArt({
  imageUrl,
  iconKey,
  glyphSize = 120,
}: {
  imageUrl?: string;
  iconKey: MediaIconKey;
  glyphSize?: number;
}) {
  const [art, setArt] = useState<string | null | undefined>(() =>
    imageUrl ? podcastArtCache.peek(imageUrl) : null,
  );

  useEffect(() => {
    if (!imageUrl) {
      setArt(null);
      return;
    }
    let live = true;
    setArt(podcastArtCache.peek(imageUrl));
    void podcastArtCache.load(imageUrl).then((v) => {
      if (live) setArt(v);
    });
    return () => {
      live = false;
    };
  }, [imageUrl]);

  return (
    <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-[14px] bg-fg/5">
      {art ? (
        <img src={art} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <MediaGlyph iconKey={iconKey} size={glyphSize} bare />
      )}
    </span>
  );
}

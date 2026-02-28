'use client';

import { useEffect, useRef, useState } from 'react';
import TextField from '@mui/material/TextField';
import type { TextFieldProps } from '@mui/material/TextField';

const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-places-script';

type WindowWithGoogleMaps = Window & {
  google?: {
    maps?: {
      places?: {
        Autocomplete: new (
          input: HTMLInputElement,
          options?: Record<string, unknown>
        ) => {
          addListener: (
            eventName: string,
            handler: () => void
          ) => {
            remove: () => void;
          };
          getPlace: () => {
            formatted_address?: string;
            name?: string;
          };
        };
      };
    };
  };
  __googleMapsLoadPromise?: Promise<void>;
};

function loadGoogleMapsPlaces(apiKey: string): Promise<void> {
  const w = window as WindowWithGoogleMaps;
  if (w.google?.maps?.places?.Autocomplete) return Promise.resolve();
  if (w.__googleMapsLoadPromise) return w.__googleMapsLoadPromise;

  w.__googleMapsLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps script.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps script.'));
    document.head.appendChild(script);
  });

  return w.__googleMapsLoadPromise;
}

interface GooglePlacesTextFieldProps
  extends Omit<TextFieldProps, 'value' | 'onChange' | 'inputRef'> {
  value: string;
  onValueChange: (value: string) => void;
}

export default function GooglePlacesTextField({
  value,
  onValueChange,
  ...textFieldProps
}: GooglePlacesTextFieldProps) {
  const [autocompleteReady, setAutocompleteReady] = useState(false);
  const [inputElement, setInputElement] = useState<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listenerRef = useRef<{ remove: () => void } | null>(null);
  const onValueChangeRef = useRef(onValueChange);
  const handleInputRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    setInputElement(node);
  };

  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  useEffect(() => {
    const apiKey = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
    if (!apiKey || !inputElement) return;

    let active = true;
    loadGoogleMapsPlaces(apiKey)
      .then(() => {
        if (!active) return;
        const w = window as WindowWithGoogleMaps;
        if (!w.google?.maps?.places?.Autocomplete) return;

        const autocomplete = new w.google.maps.places.Autocomplete(inputElement, {
          fields: ['formatted_address', 'name'],
        });

        listenerRef.current = autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          const selectedAddress = place?.formatted_address || place?.name || inputElement.value || '';
          onValueChangeRef.current(selectedAddress);
        });

        setAutocompleteReady(true);
      })
      .catch((error) => {
        console.error('Google Places initialization failed:', error);
      });

    return () => {
      active = false;
      listenerRef.current?.remove();
      listenerRef.current = null;
    };
  }, [inputElement]);

  return (
    <TextField
      {...textFieldProps}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      inputRef={handleInputRef}
      helperText={
        textFieldProps.helperText ||
        (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          ? autocompleteReady
            ? undefined
            : 'Loading address suggestions...'
          : 'Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable address suggestions.')
      }
    />
  );
}

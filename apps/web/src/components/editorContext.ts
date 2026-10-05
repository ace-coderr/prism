import { createContext, useContext } from 'react';

/** Opens the Edit profile modal; `available` is false until PrismProfiles is deployed. */
export const EditorContext = createContext<{ open: () => void; available: boolean }>({ open: () => {}, available: false });

/** Opens the Edit profile modal from anywhere (wallet menu, banners, profile pages). */
export const useProfileEditor = () => useContext(EditorContext);

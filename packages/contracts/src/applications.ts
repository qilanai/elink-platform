export type ApplicationID = 'studio' | 'sites' | 'gateway';
export type ApplicationState = 'available' | 'unavailable' | 'planned';

export interface Application {
  id: ApplicationID;
  state: ApplicationState;
  url?: string;
}

export interface ApplicationCatalog {
  applications: Application[];
}

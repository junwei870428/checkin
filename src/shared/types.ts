// 前後端共用型別

export type Role = 'admin' | 'organizer';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface UserMe {
  type: 'user';
  id: string;
  username: string;
  name: string;
  role: Role;
}

export interface StationInfo {
  id: string;
  name: string;
  kind: 'checkin' | 'gift';
  requireCheckin: boolean;
}

export interface StaffMe {
  type: 'staff';
  id: string;
  account: string;
  event: {
    id: string;
    name: string;
    startAt: number;
    endAt: number;
    rehearsal: boolean;
  };
  stations: StationInfo[];
}

export type Me = UserMe | StaffMe;

export interface AdminLoginBody {
  username: string;
  password: string;
}

export interface StaffLoginBody {
  account: string;
  pin: string;
}

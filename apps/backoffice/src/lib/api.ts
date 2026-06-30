import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gelato_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('gelato_token');
      localStorage.removeItem('gelato_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export type LoginInput = {
  email: string;
  password: string;
  tenantSlug: string;
};

export type LoginResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    tenantId: string;
    tenantSlug: string;
    betriebsstaetteIds: string[];
    roles: string[];
    permissions: string[];
  };
};

export async function login(input: LoginInput): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', input);
  return data;
}

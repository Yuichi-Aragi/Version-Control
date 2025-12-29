import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { CHANGELOG_URL } from '@/constants';

/**
 * RTK Query API for fetching the changelog.
 * Replaces manual fetch logic with a robust, cached, and cancellable solution.
 */
export const changelogApi = createApi({
    reducerPath: 'changelogApi',
    baseQuery: fetchBaseQuery({ 
        baseUrl: '/', // Base URL is required but we use absolute URL for the endpoint
    }),
    endpoints: (builder) => ({
        getChangelog: builder.query<string, void>({
            query: () => ({
                url: CHANGELOG_URL,
                responseHandler: (response) => response.text(),
            }),
            // Cache for 1 hour to prevent redundant network requests
            keepUnusedDataFor: 3600,
        }),
    }),
});

export const { useGetChangelogQuery } = changelogApi;

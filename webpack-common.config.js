const fs = require('fs');
const path = require('path');
const { DefinePlugin } = require('webpack');

const {
    getNextVersion,
    packageLoaderRules: { aliasMap: alias, tsSrcPackages },
} = require('./scripts/webpack');

const libraryName = 'checkoutKit';

const coreSrcPath = path.join(__dirname, 'packages/core/src');
const hostedFormV2SrcPath = path.join(__dirname, 'packages/hosted-form-v2/src');

const libraryEntries = {
    ...getIntegrationEntries(),
};

async function getBaseConfig(_options, argv = {}) {
    return {
        stats: {
            errorDetails: true,
            logging: 'verbose',
        },
        devtool: 'source-map',
        mode: 'production',
        resolve: {
            extensions: ['.ts', '.js'],
            alias,
        },
        module: {
            rules: [
                {
                    parser: {
                        amd: false,
                    },
                },
                {
                    test: /\.[tj]s$/,
                    enforce: 'pre',
                    loader: require.resolve('source-map-loader'),
                },
                ...tsSrcPackages,
            ],
        },
        plugins: [
            new DefinePlugin({
                LIBRARY_VERSION: JSON.stringify(await getNextVersion()),
                'process.env.NODE_ENV': JSON.stringify(
                    process.env.NODE_ENV || argv.mode || 'production',
                ),
                'process.env.ESSENTIAL_BUILD': JSON.stringify(
                    process.env.ESSENTIAL_BUILD || argv.essentialBuild || false,
                ),
            }),
        ],
    };
}

function getIntegrationEntries() {
    const integrationsPath = path.join(coreSrcPath, 'generated', 'integrations');
    const integrationFolders = {
        'google-pay-integration': path.join(
            integrationsPath,
            'google-pay-integration',
            'index.ts',
        )
    };

    return integrationFolders;
}

const babelEnvPreset = [
    '@babel/preset-env',
    {
        corejs: 3,
        targets: ['defaults'],
        useBuiltIns: 'usage',
    },
];

const babelLoaderRules = [
    {
        test: /\.[tj]s$/,
        loader: 'babel-loader',
        include: coreSrcPath,
        options: {
            presets: [babelEnvPreset],
        },
    },
    {
        test: /\.js$/,
        loader: 'babel-loader',
        include: path.join(__dirname, 'node_modules'),
        exclude: [/\/node_modules\/core-js\//, /\/node_modules\/webpack\//],
        options: {
            presets: [babelEnvPreset],
            sourceType: 'unambiguous',
        },
    },
];

module.exports = {
    babelLoaderRules,
    getBaseConfig,
    libraryEntries,
    libraryName,
    coreSrcPath,
};
